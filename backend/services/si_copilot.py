"""SI copilot — conversational + voice tactical layer.

Every request builds a FACTUAL PACKET first — the live risk model, the
ignition pressure from the compiled engine, the deterministic decision
cards, and the 3 real PSI runs closest to the chamber operating point
(services.neighbors over the consolidated master sheet). That packet is
the only evidence the LLM is allowed to cite — zero-hallucination by
construction.

Then either:

  * the 9Router gateway (OpenAI-compatible, NINE_ROUTER_BASE_URL) is
    asked for a STRICT JSON answer — json_schema mode first, plain
    json_object as a compatibility retry — validated by pydantic; or
  * when the gateway is down, slow, or returns malformed output, the
    deterministic offline synthesis answers instead (same physics, minus
    the prose) so a demo never hangs on a laptop without the router.

Voice path: transcribe_audio() forwards the clip to the whisper.cpp
server (WHISPER_CPP_URL); the transcript re-enters this same pipeline.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.services import engine_bridge as eb
from backend.services import risk, tactics

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]

try:  # python-dotenv is a hard dep, but degrade gracefully if absent
    from dotenv import load_dotenv
    load_dotenv(ROOT / "backend" / ".env")
except Exception:  # noqa: BLE001
    pass

try:
    from openai import AsyncOpenAI, BadRequestError
except ImportError:  # gateway client optional — offline fallback still works
    AsyncOpenAI = None  # type: ignore[assignment,misc]

    class BadRequestError(Exception):  # type: ignore[no-redef]
        pass

try:
    import httpx
except ImportError:  # fresh installs: openai no longer pulls httpx —
    try:            # requirements carry httpx2, a same-API fork
        import httpx2 as httpx  # type: ignore[no-redef]
    except ImportError:
        httpx = None  # type: ignore[assignment]


# ---------------- config ----------------

def _env(name: str, default: str) -> str:
    return os.environ.get(name) or default


def _llm_timeout() -> float:
    try:
        return max(1.0, float(_env("SI_LLM_TIMEOUT_S", "12")))
    except ValueError:
        return 12.0


def _stt_timeout() -> float:
    try:
        return max(1.0, float(_env("SI_STT_TIMEOUT_S", "45")))
    except ValueError:
        return 45.0


# ---------------- contract ----------------

ACTION_CODES = (
    "CUT_VENTILATION",
    "REDUCE_O2",
    "COOL_AND_ISOLATE",
    "SUPPRESS_LOCAL",
)

# voice-command navigation vocabulary — the site maps these section names
# to real DOM ids (hero→#top, shipyard→#vision, …)
SECTION_CODES = (
    "hero",
    "simulations",
    "psi-dataset",
    "dashboard",
    "chamber",
    "shipyard",
    "mission-control",
)

# dashboard investigation-matrix themes (site/src/lib/dashboard.ts)
FILTER_TAGS = (
    "detection",
    "suppression",
    "duct-flow",
    "partial-gravity",
    "large-scale",
    "spread",
    "flammability",
)

# spoken/display aliases → real investigationIds in calibration.json.
# MIR_1997 / APOLLO_1 are historical scenarios, not runnable chamber
# presets — they stay in the enum for the LLM but resolve to None.
PRESET_ALIASES = {
    "FLEX": "flex-2",
    "FLEX-2": "flex-2",
    "FLEX_2": "flex-2",
    "SAFFIRE": "saffire",
    "SAME_R": "same",
    "SAME-R": "same",
    "SAME": "same",
    "ACME": "acme",
    "ACME_EFIELD": "acme",
    "ACME_E-FIELD": "acme",
    "BASS-II": "bass-ii",
    "BASS_II": "bass-ii",
    "SOFIE-GEL": "sofie-gel",
    "SOFIE_GEL": "sofie-gel",
    "CONFINED-COMBUSTION": "confined-combustion",
    "FLARE": "flare",
    "MIR_1997": None,
    "APOLLO_1": None,
}

_O2 = {"ge": 0.0, "le": 100.0, "allow_inf_nan": False}
_FLOW = {"ge": 0.0, "le": 300.0, "allow_inf_nan": False}
_G = {"ge": 0.0, "le": 1.5, "allow_inf_nan": False}


def resolve_preset(raw: str | None) -> str | None:
    """Voice/LLM preset name → real investigationId (None when the alias
    is a historical scenario or the name is unknown)."""
    if not raw:
        return None
    key = raw.strip().upper().replace(" ", "_")
    if key in PRESET_ALIASES:
        return PRESET_ALIASES[key]
    low = raw.strip().lower()
    return low if low in eb.investigation_map() else None


def gravity_regime(g: float) -> str:
    """set_gravity_g (m/s² fraction of earth g) → nearest regime label."""
    if g <= 0.02:
        return "microgravity"
    if g < 0.3:
        return "lunar"
    if g < 0.7:
        return "martian"
    return "earth"


class ChamberState(BaseModel):
    """Current simulator state the operator is asking about."""

    model_config = ConfigDict(extra="ignore")

    investigationId: str | None = None
    materialId: str | None = None
    o2Pct: float = Field(default=21.0, **_O2)
    flowCms: float = Field(default=0.0, **_FLOW)
    gravity: str = "microgravity"
    module: str | None = None

    def resolved_material(self) -> str:
        """materialId wins; else derive it from the investigation spec."""
        if self.materialId:
            return self.materialId
        if self.investigationId:
            spec = eb.investigation_map().get(self.investigationId)
            if spec:
                return spec.get("materialId", "pmma")
        return "pmma"


class UiCommand(BaseModel):
    """Optional live-tuning instruction for the simulator UI."""

    set_o2_percent: float | None = Field(default=None, **_O2)
    set_airflow_cm_s: float | None = Field(default=None, **_FLOW)
    load_preset: str | None = None
    focus_module: str | None = None


class NavigationCommand(BaseModel):
    """Where the voice command should take the operator."""

    model_config = ConfigDict(extra="ignore")

    scroll_to_section: str | None = None
    active_filter_tag: str | None = None

    @field_validator("scroll_to_section")
    @classmethod
    def _section_known(cls, v: str | None) -> str | None:
        if v is None:
            return v
        code = v.strip().lower()
        return code if code in SECTION_CODES else None


class SimulationCommands(BaseModel):
    """Executable chamber/voice command set — superset of UiCommand."""

    model_config = ConfigDict(extra="ignore")

    load_preset: str | None = None
    set_o2_percent: float | None = Field(default=None, **_O2)
    set_airflow_cm_s: float | None = Field(default=None, **_FLOW)
    set_gravity_g: float | None = Field(default=None, **_G)
    trigger_containment: str | None = None

    @field_validator("load_preset")
    @classmethod
    def _preset_resolve(cls, v: str | None) -> str | None:
        return resolve_preset(v)

    @field_validator("trigger_containment")
    @classmethod
    def _containment_known(cls, v: str | None) -> str | None:
        if v is None:
            return v
        code = v.strip().upper()
        if code not in ACTION_CODES:
            raise ValueError(f"unknown containment code {v!r}")
        return code

    def to_ui_command(self) -> UiCommand | None:
        """Drop the voice-only fields and hand the console something it
        already knows how to apply."""
        ui = UiCommand(
            set_o2_percent=self.set_o2_percent,
            set_airflow_cm_s=self.set_airflow_cm_s,
            load_preset=self.load_preset,
        )
        return ui if ui.model_dump(exclude_none=True) else None


class CopilotResponse(BaseModel):
    """The strict shape the LLM must return — nothing else."""

    briefing: str = Field(min_length=1, max_length=2000)
    recommended_action: str
    ui_command: UiCommand | None = None
    navigation: NavigationCommand | None = None
    simulation_commands: SimulationCommands | None = None

    @field_validator("recommended_action")
    @classmethod
    def _action_known(cls, v: str) -> str:
        code = v.strip().upper()
        if code not in ACTION_CODES:
            raise ValueError(f"unknown action code {v!r}")
        return code

    def normalize(self) -> "CopilotResponse":
        """Reconcile the two command surfaces: simulation_commands is the
        voice-first contract, ui_command the legacy console one — derive
        whichever side the model left empty."""
        ui, sim = self.ui_command, self.simulation_commands
        if sim is None and ui is not None:
            # a focus_module-only command tunes nothing — mirroring it as
            # an executable containment would fire suppression for a
            # camera move; only real chamber settings earn a sim surface
            tuning = ui.model_dump(exclude_none=True,
                                   exclude={"focus_module"})
            if tuning:
                sim = self.simulation_commands = SimulationCommands(
                    load_preset=ui.load_preset,
                    set_o2_percent=ui.set_o2_percent,
                    set_airflow_cm_s=ui.set_airflow_cm_s,
                    # an emitted ui_command means the policy already
                    # decided to act — containment mirrors the action
                    trigger_containment=self.recommended_action,
                )
        if ui is None and sim is not None:
            ui = self.ui_command = sim.to_ui_command()
        # canonicalize presets on both surfaces — the console rejects
        # aliases it cannot find in its spec table, and when both sides
        # carry a preset the executable surface wins
        if sim is not None and sim.load_preset:
            if ui is not None:
                ui.load_preset = sim.load_preset
        elif ui is not None and ui.load_preset:
            resolved = resolve_preset(ui.load_preset)
            if resolved:
                ui.load_preset = resolved
        return self


# OpenAI structured-outputs schema (strict). Gateways that reject it get a
# plain {"type": "json_object"} retry instead.
_RESPONSE_SCHEMA = {
    "name": "ignis_copilot_response",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "briefing": {"type": "string"},
            "recommended_action": {"type": "string",
                                   "enum": list(ACTION_CODES)},
            "ui_command": {
                "anyOf": [
                    {
                        "type": "object",
                        "additionalProperties": False,
                        # strict mode requires every key — nullable types let
                        # the model mark the ones it does not want to change
                        "properties": {
                            "set_o2_percent": {"type": ["number", "null"]},
                            "set_airflow_cm_s": {"type": ["number", "null"]},
                            "load_preset": {"type": ["string", "null"]},
                            "focus_module": {"type": ["string", "null"]},
                        },
                        "required": ["set_o2_percent", "set_airflow_cm_s",
                                     "load_preset", "focus_module"],
                    },
                    {"type": "null"},
                ],
            },
            "navigation": {
                "anyOf": [
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "scroll_to_section": {
                                "type": ["string", "null"],
                                "enum": [*SECTION_CODES, None],
                            },
                            "active_filter_tag": {
                                "type": ["string", "null"],
                                "enum": [*FILTER_TAGS, None],
                            },
                        },
                        "required": ["scroll_to_section",
                                     "active_filter_tag"],
                    },
                    {"type": "null"},
                ],
            },
            "simulation_commands": {
                "anyOf": [
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "load_preset": {"type": ["string", "null"]},
                            "set_o2_percent": {"type": ["number", "null"]},
                            "set_airflow_cm_s": {"type": ["number", "null"]},
                            "set_gravity_g": {"type": ["number", "null"]},
                            "trigger_containment": {
                                "type": ["string", "null"],
                                "enum": [*ACTION_CODES, None],
                            },
                        },
                        "required": ["load_preset", "set_o2_percent",
                                     "set_airflow_cm_s", "set_gravity_g",
                                     "trigger_containment"],
                    },
                    {"type": "null"},
                ],
            },
        },
        "required": ["briefing", "recommended_action", "ui_command",
                     "navigation", "simulation_commands"],
    },
}

_SYSTEM = """You are IGNIS, the synthetic-intelligence copilot of an orbital
shipyard. A FACTUAL PACKET is attached — it is computed by the compiled
C++20 combustion engine and the consolidated NASA PSI master sheet
(FLEX, SAFFIRE, ACME, BASS-II, SAME, SoFIE). It is your only source of
truth.

Answer with ONE JSON object — no markdown, no extra keys:
{
  "briefing": "1-3 technical sentences for the crew",
  "recommended_action": "CUT_VENTILATION | REDUCE_O2 | COOL_AND_ISOLATE | SUPPRESS_LOCAL",
  "ui_command": null | { "set_o2_percent": number, "set_airflow_cm_s": number,
                         "load_preset": string, "focus_module": string },
  "navigation": null | { "scroll_to_section": string, "active_filter_tag": string },
  "simulation_commands": null | { "load_preset": string, "set_o2_percent": number,
     "set_airflow_cm_s": number, "set_gravity_g": number,
     "trigger_containment": "CUT_VENTILATION | REDUCE_O2 | COOL_AND_ISOLATE | SUPPRESS_LOCAL" }
}

Rules:
- Cite PSI evidence ONLY by accession/run ids present in the packet's
  `neighbors` list. Never invent test numbers, missions or citations.
- recommended_action must be exactly one of the four codes.
- ui_command: emit only when it physically helps the situation
  (e.g. CUT_VENTILATION -> set_airflow_cm_s 0; REDUCE_O2 ->
  set_o2_percent at/below the target). Otherwise null.
- navigation.scroll_to_section is one of: hero, simulations, psi-dataset,
  dashboard, chamber, shipyard, mission-control. Emit it only when the
  operator asks to see/go somewhere or a preset clearly belongs on
  screen (loading a preset -> "chamber"). active_filter_tag is one of:
  detection, suppression, duct-flow, partial-gravity, large-scale,
  spread, flammability — emit only when the operator asks to filter the
  investigation matrix by theme.
- simulation_commands.load_preset accepts these names: saffire, flex-2,
  bass-ii, acme, same, sofie-gel, confined-combustion, flare — spoken
  aliases like FLEX, SAFFIRE, SAME_R or ACME_EFIELD resolve to the same
  rigs. set_gravity_g is a fraction of earth gravity (0 = microgravity,
  ~0.17 lunar, ~0.38 martian, 1 earth).
- When the operator gives an explicit order ("cut the ventilation",
  "run saffire", "drop oxygen to 18"), mirror it in BOTH ui_command and
  simulation_commands, and set trigger_containment to the matching
  action code. For pure questions leave both null.
- `resolved_material.uncertainty` is a 90% conformal interval fitted
  on labeled PSI runs — quote it as the empirical margin. When its
  `regime` is "extrapolation" the operating point is outside the PSI
  envelope: say so explicitly instead of hiding it.
- `risk_explain` lists which physical factor drives the index — use it
  to justify the recommended action in physical terms.
- If the operator just asks a question, still pick the best standing
  action for the current chamber state."""


# ---------------- factual packet ----------------

def factual_packet(state: ChamberState) -> dict:
    """Deterministic evidence bundle built before any LLM call."""
    mat = state.resolved_material()
    o2, flow, grav = state.o2Pct, state.flowCms, state.gravity
    r = risk.risk_index(mat, o2, flow, grav)
    # decision_cards already runs the identical neighbors.nearest(mat,
    # o2, flow, 3) scan internally — reuse its result instead of
    # scanning the run table twice per message
    cards = tactics.decision_cards(mat, o2, flow, grav)
    nb = cards["neighbors"]
    ign = eb.ignition_pressure(r["materialId"], o2)
    # compact option summary — full card payloads would flood the prompt
    options = [
        {"card": c["id"], "context": c["context"],
         "options": [{"label": o["label"], "score": o["score"],
                      "action": o["action"]} for o in c["options"]]}
        for c in cards["cards"]
    ]
    return {
        "material": r,
        "engine": eb.ENGINE,
        "ignitionPressure": round(ign, 4),
        "engineRiskIndex": round(
            eb.risk_index(r["materialId"], o2, flow, grav), 4),
        "neighbors": nb,
        "decisionOptions": options,
        "briefing": cards["briefing"],
    }


# ---------------- offline deterministic answer ----------------

def _offline_response(state: ChamberState, packet: dict) -> CopilotResponse:
    """Policy-table answer — same physics the cards were scored on."""
    r = packet["material"]
    flags = r["flags"]
    mat_id, loc = r["materialId"], r["locPct"]
    idx, margin = r["riskIndex"], r["margin"]

    if flags["belowLoc"] or idx < 0.25:
        action, ui = "SUPPRESS_LOCAL", UiCommand(focus_module=state.module)
    elif state.flowCms >= 8 and idx >= 0.5:
        action = "CUT_VENTILATION"
        ui = UiCommand(set_airflow_cm_s=0.0)
    elif flags["smoldering"] and idx >= 0.5:
        action = "COOL_AND_ISOLATE"
        ui = UiCommand(set_airflow_cm_s=0.0)
    elif margin > 3:
        # shrink toward ~1 pt above LOC, mirroring tactics' reduce-o2 card
        target = max(0.0, min(loc + 1.0, state.o2Pct - 1.0))
        action = "REDUCE_O2"
        ui = UiCommand(set_o2_percent=round(target, 1))
    else:
        action, ui = "SUPPRESS_LOCAL", None

    cites = ", ".join(
        f"{n['accession']} run {n['runId']}".strip() for n in packet["neighbors"]
    )
    briefing = packet["briefing"]
    if cites:
        briefing += f" Evidence: {cites}."
    u = r.get("uncertainty")
    if u:
        briefing += (f" Empirical band {u['lower'] * 100:.0f}–"
                     f"{u['upper'] * 100:.0f}% (90% conformal, "
                     f"n={u['calibrationN']} psi runs).")
        if u["regime"] == "extrapolation":
            briefing += (" Operating point is outside the calibrated "
                         "PSI envelope — extrapolation regime.")
    # the voice contract: when the policy decided to act on the sim the
    # command is executable, so containment mirrors the action. A
    # focus_module-only ui (or an all-None one) tunes nothing — emitting
    # sim/nav for it would yank the page and fire a phantom containment
    tuning = (ui.model_dump(exclude_none=True, exclude={"focus_module"})
              if ui is not None else {})
    sim = None
    if tuning:
        sim = SimulationCommands(
            load_preset=ui.load_preset,
            set_o2_percent=ui.set_o2_percent,
            set_airflow_cm_s=ui.set_airflow_cm_s,
            trigger_containment=action,
        )
    nav = NavigationCommand(scroll_to_section="chamber") if sim else None
    return CopilotResponse(briefing=briefing, recommended_action=action,
                           ui_command=ui, navigation=nav,
                           simulation_commands=sim)


# ---------------- 9Router LLM call ----------------

_client: AsyncOpenAI | None = None


def _llm_client() -> AsyncOpenAI | None:
    global _client
    if AsyncOpenAI is None:
        return None
    if _client is None:
        _client = AsyncOpenAI(
            base_url=_env("NINE_ROUTER_BASE_URL", "http://localhost:20128/v1"),
            api_key=_env("NINE_ROUTER_API_KEY", "local-9router-key"),
            timeout=_llm_timeout(),
            max_retries=1,
        )
    return _client


def _compact_material(r: dict) -> dict:
    """Slim resolved_material for the prompt — drops the Shapley block
    (surfaced separately as risk_explain) and the conformal internals
    the LLM is never asked to quote. ~55% smaller than the raw dict."""
    u = r.get("uncertainty") or {}
    return {
        "materialId": r["materialId"],
        "materialName": r["materialName"],
        "o2Pct": r["o2Pct"],
        "flowCms": r["flowCms"],
        "gravity": r["gravity"],
        "locPct": r["locPct"],
        "margin": r["margin"],
        "riskIndex": r["riskIndex"],
        "level": r["level"],
        "breakdown": r["breakdown"],
        "flags": r["flags"],
        "uncertainty": {
            "lower": u.get("lower"),
            "upper": u.get("upper"),
            "regime": u.get("regime"),
            "calibrationN": u.get("calibrationN"),
        } if u else None,
    }


def _messages(message: str, state: ChamberState, packet: dict) -> list[dict]:
    exp = (packet["material"].get("explanation") or {}).get(
        "contributions") or []
    user = {
        "operator_message": message,
        "chamber_state": state.model_dump(exclude_none=True),
        "resolved_material": _compact_material(packet["material"]),
        "engine_ignition_pressure": packet["ignitionPressure"],
        "engine_risk_index": packet["engineRiskIndex"],
        "nearest_psi_runs": packet["neighbors"],
        # one best option per card is all the LLM needs to phrase the
        # recommendation — the full option lattice costs ~2x tokens
        "decision_options": [
            {"card": c["card"], "context": c["context"],
             "best": max(c["options"], key=lambda o: o["score"])
                    if c["options"] else None}
            for c in packet["decisionOptions"]
        ],
        "risk_explain": [{"factor": c["label"], "share": c["share"]}
                         for c in exp[:4]],
    }
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ]


async def _llm_response(message: str, state: ChamberState,
                        packet: dict) -> CopilotResponse | None:
    """Ask 9Router; None means any failure (down, timeout, bad JSON)."""
    client = _llm_client()
    if client is None:
        return None
    model = _env("NINE_ROUTER_MODEL", "auto")
    kwargs = {
        "model": model,
        "messages": _messages(message, state, packet),
        "temperature": 0.2,
        "max_tokens": 700,
    }
    try:
        completion = await client.chat.completions.create(
            response_format={"type": "json_schema",
                             "json_schema": _RESPONSE_SCHEMA},
            **kwargs)
    except BadRequestError:
        try:  # gateway/model without schema support → plain JSON mode
            completion = await client.chat.completions.create(
                response_format={"type": "json_object"}, **kwargs)
        except Exception as exc:  # noqa: BLE001
            logger.info("9Router json_object call failed: %s", exc)
            return None
    except Exception as exc:  # noqa: BLE001 - connection, timeout, 5xx
        logger.info("9Router unreachable, using offline fallback: %s", exc)
        return None

    try:
        content = completion.choices[0].message.content or ""
        data = json.loads(content)
        return CopilotResponse.model_validate(data)
    except Exception as exc:  # noqa: BLE001 - malformed → deterministic
        logger.info("9Router returned unusable payload: %s", exc)
        return None


# ---------------- public API ----------------

async def answer(message: str, state: ChamberState) -> dict:
    """Structured copilot reply grounded on the factual packet."""
    # the packet walks the model + CSV + card scoring — keep the event
    # loop free while it runs
    packet = await asyncio.to_thread(factual_packet, state)
    resp = await _llm_response(message, state, packet)
    mode = "llm"
    if resp is None:
        resp = await asyncio.to_thread(_offline_response, state, packet)
        mode = "offline-fallback"
    resp = resp.normalize()
    return {
        **resp.model_dump(),
        "mode": mode,
        "model": _env("NINE_ROUTER_MODEL", "auto") if mode == "llm"
                 else "deterministic",
        "engine": packet["engine"],
        "chamber": {
            "investigationId": state.investigationId,
            "materialId": packet["material"]["materialId"],
            "o2Pct": state.o2Pct,
            "flowCms": state.flowCms,
            "gravity": state.gravity,
            "riskIndex": packet["material"]["riskIndex"],
            "level": packet["material"]["level"],
            "uncertainty": packet["material"].get("uncertainty"),
        },
        "evidence": [
            {
                "runId": n["runId"],
                "accession": n["accession"],
                "investigationId": n["investigationId"],
                "fuel": n["fuel"],
                "outcome": n["outcome"],
                "similarity": n["similarity"],
                "verified": n["verified"],
                "sourceUrl": n["sourceUrl"],
            }
            for n in packet["neighbors"]
        ],
    }


async def transcribe_audio(payload: bytes, filename: str | None = None,
                           content_type: str | None = None) -> str | None:
    """Forward the clip to the STT endpoint; None means STT unavailable.

    Any OpenAI-compatible /audio/transcriptions route works: local
    whisper.cpp (default), Groq (`STT_BASE_URL=https://api.groq.com/
    openai/v1/audio/transcriptions`, `STT_API_KEY`, `STT_MODEL=
    whisper-large-v3-turbo`), etc. Auth and model are only sent when
    configured — whisper.cpp ignores neither being absent.
    """
    if httpx is None or not payload:
        return None
    url = _env("STT_BASE_URL",
               _env("WHISPER_CPP_URL",
                    "http://localhost:8081/v1/audio/transcriptions"))
    api_key = os.environ.get("STT_API_KEY") or os.environ.get(
        "WHISPER_CPP_API_KEY") or ""
    model = os.environ.get("STT_MODEL") or ""
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    data = {"response_format": "json"}
    if model:
        data["model"] = model
    try:
        async with httpx.AsyncClient(timeout=_stt_timeout()) as c:
            r = await c.post(
                url,
                headers=headers,
                files={"file": (filename or "audio.webm", payload,
                                content_type or "application/octet-stream")},
                data=data,
            )
        r.raise_for_status()
        text = (r.json().get("text") or "").strip()
        return text or None
    except Exception as exc:  # noqa: BLE001
        logger.info("STT endpoint unreachable: %s", exc)
        return None
