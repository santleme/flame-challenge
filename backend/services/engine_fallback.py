"""Pure-Python port of the freefall_engine C++ extension.

Drop-in replacement exposing the same snake_case API as the pybind module
(see core/bindings/python.cpp) so backend/services/engine_bridge.py can
use it transparently when core/build/freefall_engine.*.so is unavailable
(not built, wrong platform/ABI).

The models mirror core/src/{material_risk,combustion_solver,
airflow_propagator,chamber}.cpp — keep them in sync.
"""
from __future__ import annotations

import copy
import json
import math
from dataclasses import dataclass, replace

T_FLAME_MAX = 2300.0  # K — adiabatic flame temperature envelope
T_COOL_FLAME = 800.0  # K — cool flames sit ~500–800 K
AMBIENT_K = 298.0

# DropletFlame::Regime
DROPLET_IGNITION, DROPLET_HOT, DROPLET_COOL, DROPLET_EXTINCTION, DROPLET_OUT = range(5)
# SolidSpread::Regime
SPREAD_PREHEAT, SPREAD_SPREADING, SPREAD_COOLING, SPREAD_OUT = range(4)


@dataclass
class Material:
    id: str = ""
    name: str = ""
    locPct: float = 17.0
    spreadMinCms: float = 0.2
    spreadMaxCms: float = 4.0
    sootIndex: float = 0.3
    coolFlameCapable: bool = False
    smoldering: bool = False


def _ignition_pressure(m: Material, o2_pct: float) -> float:
    """MaterialRisk::ignitionPressure — 0 at/below LOC, ~margin^1.35 above."""
    margin = o2_pct - m.locPct
    if margin <= 0:
        # µg caveat: flames can persist slightly below Earth LOC (SoFIE) —
        # retain a small residual pressure instead of a hard zero.
        return 0.04 if margin > -3.0 else 0.0
    return min(1.0, 0.04 + 0.055 * margin ** 1.35)


class MaterialRisk:
    """ACME-style flammability matrix (material_risk.cpp)."""

    _FIELDS = ("name", "locPct", "spreadMinCms", "spreadMaxCms",
               "sootIndex", "coolFlameCapable", "smoldering")

    def __init__(self) -> None:
        # starter table — same values compiled into the C++ ctor
        self.table: dict[str, Material] = {}
        for m in (
            Material("heptane", "n-Heptane droplet", 12.0, 0.0, 0.0, 0.55, True, False),
            Material("methanol", "Methanol droplet", 12.5, 0.0, 0.0, 0.10, True, False),
            Material("pmma", "PMMA (acrylic)", 15.0, 0.3, 3.5, 0.35, False, False),
            Material("pmma-sphere", "PMMA sphere", 17.0, 0.2, 4.0, 0.35, False, True),
            Material("cotton", "Cotton fabric", 17.0, 0.3, 4.0, 0.20, False, True),
            Material("nomex", "Nomex", 21.0, 0.2, 2.5, 0.15, False, True),
            Material("polycarbonate", "Polycarbonate", 19.0, 0.2, 3.0, 0.60, False, False),
            Material("card-gas", "Cardboard gas phase", 16.0, 0.4, 5.0, 0.30, False, True),
        ):
            self.table[m.id] = m

    def load_json(self, doc: str) -> None:
        """Merge {"materials": [{...}]} — fields absent from JSON keep the
        existing/default values, like MaterialRisk::loadJson."""
        try:
            mats = json.loads(doc).get("materials", [])
        except json.JSONDecodeError:
            return
        if not isinstance(mats, list):
            return
        for j in mats:
            if not isinstance(j, dict) or not isinstance(j.get("id"), str):
                continue
            m = self.table.get(j["id"], Material())
            m.id = j["id"]
            for k in self._FIELDS:
                if k in j:
                    setattr(m, k, j[k])
            self.table[m.id] = m

    def all(self) -> list[Material]:
        return list(self.table.values())

    def ignition_pressure(self, material_id: str, o2_pct: float) -> float:
        m = self.table.get(material_id)
        return _ignition_pressure(m, float(o2_pct)) if m else -1.0


class _DropletFlame:
    """FLEX-type droplet combustion — d²-law + cool-flame regime
    (combustion_solver.cpp)."""

    def __init__(self) -> None:
        self.c_d0 = 1.0
        self.c_o2 = 21.0
        self.c_pressure = 101.0
        self.c_mat = Material()
        self.rng = 1
        self.t_sec = 0.0
        self.droplet_d_mm = 0.0
        self.flame_r_mm = 0.0
        self.temp_k = 0.0
        self.heat_w = 0.0
        self.burn_fraction = 0.0
        self.regime = DROPLET_IGNITION
        self.cool_phase_t = 0.0

    def _next_random(self) -> float:
        # xorshift32, same draw sequence as the C++ engine
        r = self.rng
        r = (r ^ (r << 13)) & 0xFFFFFFFF
        r = (r ^ (r >> 17)) & 0xFFFFFFFF
        r = (r ^ (r << 5)) & 0xFFFFFFFF
        self.rng = r
        return (r & 0xFFFFFF) / 0x1000000

    def configure(self, droplet_d0_mm: float, o2_pct: float,
                  pressure_kpa: float, material: Material, seed: int) -> None:
        self.c_d0 = max(0.0, droplet_d0_mm)
        self.c_o2 = o2_pct
        self.c_pressure = pressure_kpa
        self.c_mat = material
        self.rng = (int(seed) & 0xFFFFFFFF) or 1
        # stochastic ignition delay ~ tens of ms, seeded
        self.t_sec = -0.02 - self._next_random() * 0.08
        self.droplet_d_mm = self.c_d0
        self.flame_r_mm = 0.0
        self.temp_k = 0.0
        self.heat_w = 0.0
        self.burn_fraction = 0.0
        self.regime = DROPLET_IGNITION
        self.cool_phase_t = 0.0

    def update_atmosphere(self, o2_pct: float, pressure_kpa: float) -> None:
        self.c_o2 = o2_pct
        self.c_pressure = pressure_kpa

    def _burned_fraction(self) -> float:
        # remaining mass ∝ d³ — not the d² ratio the d²-law tracks
        if self.c_d0 <= 0:
            return 1.0
        r = min(max(self.droplet_d_mm / self.c_d0, 0.0), 1.0)
        return 1.0 - r * r * r

    def burn_rate_k(self) -> float:
        # K grows with O₂ above LOC; ~0.5–0.8 mm²/s for heptane at 1 atm
        press = _ignition_pressure(self.c_mat, self.c_o2)
        return (0.45 + 0.55 * press) * min(self.c_pressure / 101.0, 1.5)

    def step(self, dt: float) -> None:
        self.t_sec += dt
        if self.t_sec < 0:
            return  # still in ignition delay

        if self.regime == DROPLET_IGNITION:
            if _ignition_pressure(self.c_mat, self.c_o2) <= 0:
                self.regime = DROPLET_EXTINCTION
            else:
                self.regime = DROPLET_HOT

        elif self.regime == DROPLET_HOT:
            k = self.burn_rate_k()  # mm²/s
            d2 = self.droplet_d_mm * self.droplet_d_mm - k * dt
            self.droplet_d_mm = math.sqrt(d2) if d2 > 0 else 0.0
            self.burn_fraction = self._burned_fraction()

            # spherical flame standoff: r_f/r_d ∝ oxidizer flux margin
            margin = max(0.0, self.c_o2 - self.c_mat.locPct)
            self.flame_r_mm = 0.5 * self.droplet_d_mm * (3.0 + 0.9 * margin)

            press = _ignition_pressure(self.c_mat, self.c_o2)
            self.temp_k = AMBIENT_K + (T_FLAME_MAX - AMBIENT_K) * press
            self.heat_w = k * 40.0 * press  # scaled, W

            low_o2 = self.c_o2 < self.c_mat.locPct - 0.5
            fuel_out = self.droplet_d_mm <= 0.02
            if low_o2 or fuel_out:
                if (self.c_mat.coolFlameCapable and not fuel_out
                        and self._next_random() < 0.8):
                    # FLEX: hot flame out → cool-flame chemistry continues
                    self.cool_phase_t = 0.0
                    self.regime = DROPLET_COOL
                else:
                    self.regime = DROPLET_OUT

        elif self.regime == DROPLET_COOL:
            self.cool_phase_t += dt
            # low heat release, flame collapses onto the droplet
            self.flame_r_mm = max(0.0, self.flame_r_mm - dt * self.droplet_d_mm)
            self.temp_k = AMBIENT_K + (T_COOL_FLAME - AMBIENT_K) * 0.5
            self.heat_w *= max(0.0, 1.0 - dt * 0.4)
            d2 = (self.droplet_d_mm * self.droplet_d_mm
                  - 0.05 * self.burn_rate_k() * dt)
            self.droplet_d_mm = math.sqrt(d2) if d2 > 0 else 0.0
            self.burn_fraction = self._burned_fraction()
            # a cool flame cannot outlive its droplet; otherwise it fades on
            # a timer or flashes back to hot combustion if O₂ is restored
            if self.droplet_d_mm <= 0.02:
                self.flame_r_mm = 0.0
                self.heat_w = 0.0
                self.regime = DROPLET_OUT
            elif self.cool_phase_t > 8.0 + self._next_random() * 6.0:
                self.heat_w = 0.0
                self.regime = DROPLET_OUT
            elif (self.c_o2 > self.c_mat.locPct
                    and self._next_random() < dt * 0.5):
                self.regime = DROPLET_HOT

        elif self.regime == DROPLET_EXTINCTION:
            self.regime = DROPLET_OUT

        else:  # DROPLET_OUT
            self.temp_k = max(AMBIENT_K, self.temp_k - 60 * dt)
            self.heat_w = 0.0


class _SolidSpread:
    """SAFFIRE/SoFIE-type flame spread over a solid slab
    (airflow_propagator.cpp)."""

    def __init__(self) -> None:
        self.c_slab = 30.0
        self.c_o2 = 21.0
        self.c_flow = 0.0
        self.c_pressure = 101.0
        self.c_partial_g = False
        self.c_mat = Material()
        self.t_sec = 0.0
        self.front_cm = 0.0
        self.rate_cms = 0.0
        self.burn_len_cm = 0.0
        self.intensity = 0.0
        self.regime = SPREAD_PREHEAT

    def configure(self, slab_cm: float, o2_pct: float, flow_cms: float,
                  pressure_kpa: float, partial_g: bool,
                  material: Material) -> None:
        self.c_slab = slab_cm
        self.c_o2 = o2_pct
        self.c_flow = flow_cms
        self.c_pressure = pressure_kpa
        self.c_partial_g = partial_g
        self.c_mat = material
        self.t_sec = 0.0
        self.front_cm = 0.0
        self.rate_cms = 0.0
        self.burn_len_cm = 0.0
        self.intensity = 0.0
        self.regime = SPREAD_PREHEAT

    def update_atmosphere(self, o2_pct: float, flow_cms: float,
                          pressure_kpa: float) -> None:
        self.c_o2 = o2_pct
        self.c_flow = flow_cms
        self.c_pressure = pressure_kpa

    def _nominal_rate(self) -> float:
        m = self.c_mat
        # interpolate within the measured spread range by O₂ margin
        margin = self.c_o2 - m.locPct
        span = max(0.01, m.spreadMaxCms - m.spreadMinCms)
        o2_frac = min(max(margin / 25.0, 0.0), 1.0)
        v = m.spreadMinCms + span * o2_frac ** 0.8
        # opposed forced flow aids spread; concurrent flow can blow off
        v *= 1.0 + min(max(self.c_flow / 20.0, 0.0), 1.5)
        # partial gravity (Moon/Mars) reduces buoyancy-driven transport
        if self.c_partial_g:
            v *= 0.7
        return v

    def _oxygen_limit_extinct(self) -> bool:
        return self.c_o2 < self.c_mat.locPct

    def _quiescent_extinct(self) -> bool:
        # SoFIE: at very low flow, radiative loss beats heat feedback → out
        return self.c_flow < 1.0 and self.c_o2 < self.c_mat.locPct + 3.0

    def _intensity(self, v: float) -> float:
        # C++ divides by spreadMaxCms directly: a zero-cap material yields
        # inf (→1.0) for v>0 and NaN for v=0. NaN cannot serialize to JSON,
        # so the fallback maps the degenerate case to 0.0 for a dead front.
        if self.c_mat.spreadMaxCms <= 0:
            return 1.0 if v > 0 else 0.0
        return min(max(0.3 + v / self.c_mat.spreadMaxCms, 0.0), 1.0)

    def step(self, dt: float) -> None:
        self.t_sec += dt

        if self.regime == SPREAD_PREHEAT:
            if self.t_sec > 1.5:
                if self._oxygen_limit_extinct() or self._quiescent_extinct():
                    self.regime = SPREAD_OUT
                else:
                    # enter Spreading with a consistent first-frame state
                    self.regime = SPREAD_SPREADING
                    self.rate_cms = self._nominal_rate()
                    self.intensity = self._intensity(self.rate_cms)

        elif self.regime == SPREAD_SPREADING:
            v = self._nominal_rate()
            if self._oxygen_limit_extinct():
                v = 0.0
            self.rate_cms = v
            self.front_cm += v * dt
            self.burn_len_cm = min(self.front_cm, self.c_slab)
            self.intensity = self._intensity(v)
            if self.front_cm >= self.c_slab or v <= 0:
                self.regime = SPREAD_COOLING

        elif self.regime == SPREAD_COOLING:
            self.intensity = max(0.0, self.intensity - dt * 0.25)
            self.rate_cms = 0.0
            if self.intensity <= 0:
                self.regime = SPREAD_OUT


@dataclass
class ChamberConfig:
    investigationId: str = ""
    materialId: str = ""
    model: str = "spread"  # "droplet" | "spread"
    o2Pct: float = 21.0
    flowCms: float = 0.0
    pressureKpa: float = 101.0
    slabLengthCm: float = 30.0
    dropletD0Mm: float = 1.0
    partialGravity: bool = False
    seed: int = 1


class Chamber:
    """Game-facing experiment chamber (chamber.cpp) — aggregates the
    reduced-order models and reports regime transitions."""

    # same fallback used by Chamber::configure for unknown materials
    _FALLBACK_MATERIAL = Material("pmma", "PMMA", 15.0, 0.3, 3.5, 0.35,
                                  False, False)

    def __init__(self, risks: MaterialRisk | None = None) -> None:
        # C++ takes MaterialRisk by value — a later load_json on the shared
        # object must not rewrite materials inside live chambers.
        self._risks = copy.deepcopy(risks) if risks is not None else MaterialRisk()
        self._cfg = ChamberConfig()
        self._droplet = _DropletFlame()
        self._spread = _SolidSpread()
        self._use_droplet = True
        self._ignited = False
        self._last_regime = -1
        self._events: list[str] = []

    def configure(self, cfg: ChamberConfig) -> None:
        # C++ copies the Config by value — two chambers must not share the
        # caller's object, or update_atmosphere on one corrupts the other.
        self._cfg = replace(cfg)
        self._use_droplet = cfg.model == "droplet"
        # copy the Material too — sub-model configs are by value in C++
        mat = replace(self._risks.table.get(cfg.materialId)
                    or self._FALLBACK_MATERIAL)
        if self._use_droplet:
            self._droplet.configure(cfg.dropletD0Mm, cfg.o2Pct,
                                    cfg.pressureKpa, mat, cfg.seed)
        else:
            self._spread.configure(cfg.slabLengthCm, cfg.o2Pct, cfg.flowCms,
                                   cfg.pressureKpa, cfg.partialGravity, mat)
        self._ignited = False
        self._last_regime = -1
        self._events.clear()

    def update_atmosphere(self, o2_pct: float, flow_cms: float,
                          pressure_kpa: float) -> None:
        self._cfg.o2Pct = o2_pct
        self._cfg.flowCms = flow_cms
        self._cfg.pressureKpa = pressure_kpa
        self._droplet.update_atmosphere(o2_pct, pressure_kpa)
        self._spread.update_atmosphere(o2_pct, flow_cms, pressure_kpa)

    def ignition_pressure(self) -> float:
        m = self._risks.table.get(self._cfg.materialId)
        return _ignition_pressure(m, self._cfg.o2Pct) if m else 0.5

    def step(self, dt_sec: float) -> None:
        if self._use_droplet:
            self._droplet.step(dt_sec)
            r = self._droplet.regime
            if r == DROPLET_HOT and not self._ignited:
                self._ignited = True
                self._events.append("ignited")
            elif r == DROPLET_HOT and self._last_regime == DROPLET_COOL:
                self._events.append("reignited")
            if r == DROPLET_COOL and self._last_regime != r:
                self._events.append("cool-flame-onset")
            if r == DROPLET_OUT and self._last_regime != r:
                self._events.append("extinguished")
            self._last_regime = r
        else:
            self._spread.step(dt_sec)
            r = self._spread.regime
            if r == SPREAD_SPREADING and not self._ignited:
                self._ignited = True
                self._events.append("ignited")
            if r == SPREAD_OUT and self._last_regime != r:
                self._events.append("extinguished")
            self._last_regime = r

    def regime(self) -> int:
        return (self._droplet.regime if self._use_droplet
                else self._spread.regime)

    def hot_burning(self) -> bool:
        return (self._droplet.regime == DROPLET_HOT if self._use_droplet
                else self._spread.regime == SPREAD_SPREADING)

    def cool_flame(self) -> bool:
        return self._use_droplet and self._droplet.regime == DROPLET_COOL

    def finished(self) -> bool:
        return (self._droplet.regime == DROPLET_OUT if self._use_droplet
                else self._spread.regime == SPREAD_OUT)

    def drain_events(self) -> list[str]:
        out = self._events
        self._events = []
        return out

    def state_json(self) -> str:
        if self._use_droplet:
            s = self._droplet
            return json.dumps({
                "model": "droplet",
                "tSec": round(s.t_sec, 3),
                "regime": s.regime,
                "dropletDMm": round(s.droplet_d_mm, 3),
                "flameRMm": round(s.flame_r_mm, 3),
                "flameTempK": round(s.temp_k, 1),
                "heatReleaseW": round(s.heat_w, 2),
                "burnFraction": round(s.burn_fraction, 3),
                "ignited": self._ignited,
                "coolFlame": self.cool_flame(),
                "finished": self.finished(),
            }, separators=(",", ":"))
        s = self._spread
        return json.dumps({
            "model": "spread",
            "tSec": round(s.t_sec, 3),
            "regime": s.regime,
            "frontPosCm": round(s.front_cm, 3),
            "spreadRateCms": round(s.rate_cms, 3),
            "burnLengthCm": round(s.burn_len_cm, 3),
            "intensity": round(s.intensity, 3),
            "ignited": self._ignited,
            "coolFlame": False,
            "finished": self.finished(),
        }, separators=(",", ":"))
