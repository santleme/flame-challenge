#include "airflow_propagator.hpp"

#include <algorithm>
#include <cmath>

namespace ff {

void SolidSpread::configure(const Config& cfg) {
    c_ = cfg;
    s_ = State{};
    s_.regime = Regime::Preheat;
}

void SolidSpread::updateAtmosphere(double o2Pct, double flowCms, double pressureKpa) {
    c_.o2Pct = std::clamp(o2Pct, 0.0, 100.0);
    c_.flowCms = std::max(0.0, flowCms);
    c_.pressureKpa = std::max(0.0, pressureKpa);
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
    // partial gravity (Moon/Mars) reduces buoyancy-driven transport
    if (c_.partialGravity) v *= 0.7;
    return v;
}

bool SolidSpread::oxygenLimitExtinct() const {
    return c_.o2Pct < c_.material.locPct;
}

bool SolidSpread::quiescentExtinct() const {
    // SoFIE: at very low flow, radiative loss beats heat feedback → out
    return c_.flowCms < 1.0 && c_.o2Pct < c_.material.locPct + 3.0;
}

void SolidSpread::step(double dtSec) {
    s_.tSec += dtSec;

    switch (s_.regime) {
    case Regime::Preheat:
        if (s_.tSec > 1.5) {
            if (oxygenLimitExtinct() || quiescentExtinct()) {
                s_.regime = Regime::Out;
            } else {
                // enter Spreading with a consistent first-frame state —
                // callers must never observe the regime with a zero rate,
                // and the front must not stall for a tick
                s_.regime = Regime::Spreading;
                s_.spreadRateCms = nominalRate();
                s_.frontPosCm += s_.spreadRateCms * dtSec;
                s_.burnLengthCm = std::min(s_.frontPosCm, c_.slabLengthCm);
                s_.intensity = std::clamp(
                    0.3 + s_.spreadRateCms / c_.material.spreadMaxCms, 0.0, 1.0);
            }
        }
        break;

    case Regime::Spreading: {
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
