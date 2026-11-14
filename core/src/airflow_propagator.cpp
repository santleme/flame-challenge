#include "airflow_propagator.hpp"

#include <algorithm>
#include <cmath>

namespace ff {

void SolidSpread::configure(const Config& cfg) {
    c_ = cfg;
    s_ = State{};
    s_.regime = Regime::Preheat;
}

double SolidSpread::nominalRate() const {
    const auto& m = c_.material;
    // interpolate within the measured spread range by O₂ margin
    const double margin = c_.o2Pct - m.locPct;
    const double span = std::max(0.01, m.spreadMaxCms - m.spreadMinCms);
    const double o2Frac = std::clamp(margin / 25.0, 0.0, 1.0);
    double v = m.spreadMinCms + span * std::pow(o2Frac, 0.8);
    // opposed forced flow aids spread; concurrent flow can also blow off
    v *= 1.0 + std::clamp(c_.flowCms / 20.0, 0.0, 1.5);
    // Apollo-1 enriched atmosphere: ignition-to-flashover propagates ~2.5×
    if (c_.o2Source == 1) v *= 2.5;
    // Mir chemical generator: sustained burn regardless of vent state
    if (c_.o2Source == 2) v *= 1.4;
    // partial gravity (Moon/Mars) reduces buoyancy-driven transport
    if (c_.partialGravity) v *= 0.7;
    return v;
}

bool SolidSpread::oxygenLimitExtinct() const {
    // CHEMICAL_GENERATOR (Mir-1997): the oxidizer is inside the fuel,
    // so cutting cabin O₂ below LOC does NOT extinguish it. Only
    // continuous cooling stops a self-oxidizing fire.
    if (c_.o2Source == 2 && !c_.coolingApplied) return false;
    return c_.o2Pct < c_.material.locPct;
}

bool SolidSpread::quiescentExtinct() const {
    // SoFIE: at very low flow, radiative loss beats heat feedback → out.
    // Mir regime bypasses this for the same reason (self-fed oxidizer).
    if (c_.o2Source == 2 && !c_.coolingApplied) return false;
    return c_.flowCms < 1.0 && c_.o2Pct < c_.material.locPct + 3.0;
}

void SolidSpread::step(double dtSec) {
    s_.tSec += dtSec;

    switch (s_.regime) {
    case Regime::Preheat:
        if (s_.tSec > 1.5) {
            if (oxygenLimitExtinct() || quiescentExtinct())
                s_.regime = Regime::Out;
            else
                s_.regime = Regime::Spreading;
        }
        break;

    case Regime::Spreading: {
        // Mir self-oxidizing fire: only continuous cooling stops it —
        // the front keeps advancing until fuel is spent or cooling is on.
        if (c_.o2Source == 2 && !c_.coolingApplied) {
            const double v = nominalRate();
            s_.spreadRateCms = v;
            s_.frontPosCm += v * dtSec;
            s_.burnLengthCm = std::min(s_.frontPosCm, c_.slabLengthCm);
            s_.intensity = std::clamp(0.5 + v / c_.material.spreadMaxCms, 0.0, 1.0);
            if (s_.frontPosCm >= c_.slabLengthCm)
                s_.regime = Regime::Cooling;
            break;
        }
        double v = nominalRate();
        if (oxygenLimitExtinct()) v = 0;
        s_.spreadRateCms = v;
        s_.frontPosCm += v * dtSec;
        s_.burnLengthCm = std::min(s_.frontPosCm, c_.slabLengthCm);
        s_.intensity = std::clamp(0.3 + v / c_.material.spreadMaxCms, 0.0, 1.0);
        if (s_.frontPosCm >= c_.slabLengthCm || v <= 0)
            s_.regime = Regime::Cooling;
        break;
    }

    case Regime::Cooling:
        s_.intensity = std::max(0.0, s_.intensity - dtSec * 0.25);
        s_.spreadRateCms = 0;
        if (s_.intensity <= 0) s_.regime = Regime::Out;
        break;

    case Regime::Out:
        break;
    }
}

} // namespace ff
