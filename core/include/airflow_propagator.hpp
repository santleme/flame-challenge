#pragma once

#include "material_risk.hpp"

namespace ff {

/**
 * SAFFIRE/SoFIE-type flame spread over a solid fuel slab (reduced order).
 *
 * Two extinction regimes from the SoFIE campaign are reproduced:
 *  - oxygen-limit extinction at higher forced flow,
 *  - radiative/blow-off extinction in the quiescent/low-flow regime.
 * Spread rate scales with the margin above the material LOC and the
 * applied opposed-flow velocity.
 */
class SolidSpread {
  public:
    enum class Regime : int { Preheat = 0, Spreading = 1, Cooling = 2, Out = 3 };

    struct Config {
        double slabLengthCm = 30.0;
        double o2Pct = 21.0;
        double flowCms = 0.0;       // forced opposed flow, cm/s
        double pressureKpa = 101.0;
        bool partialGravity = false; // lunar/Martian correction
        Material material;
        /** oxidizer regime: 0 ambient, 1 enriched (Apollo 1), 2 chemical (Mir) */
        int o2Source = 0;
        /** Mir only: continuous cooling applied → self-oxidizing fire stops */
        bool coolingApplied = false;
    };

    struct State {
        double tSec = 0;
        double frontPosCm = 0;      // pyrolysis front position along slab
        double spreadRateCms = 0;   // instantaneous, cm/s
        double burnLengthCm = 0;    // charred length behind the front
        double intensity = 0;       // 0..1 — maps to flame size in UI
        Regime regime = Regime::Preheat;
    };

    void configure(const Config& cfg);
    void step(double dtSec);
    const State& state() const { return s_; }

    /** Mir regime: applying continuous cooling stops a self-oxidizing fire */
    void setCooling(bool on) { c_.coolingApplied = on; }

  private:
    Config c_;
    State s_;

    /** nominal spread rate at the current atmosphere, cm/s */
    double nominalRate() const;
    bool quiescentExtinct() const;
    bool oxygenLimitExtinct() const;
};

} // namespace ff
