#pragma once

#include <string>
#include <unordered_map>
#include <vector>

namespace ff {

/**
 * ACME-style material flammability matrix.
 * Constants are calibrated from NASA PSI investigation records
 * (see data-pipeline/processed/calibration.json).
 */
struct Material {
    std::string id;
    std::string name;
    /** limiting oxygen concentration below which flame cannot sustain (%) */
    double locPct = 17.0;
    /** flame spread range over the material, cm/s */
    double spreadMinCms = 0.2;
    double spreadMaxCms = 4.0;
    /** 0..1 — sooting propensity (ACME burner measurements) */
    double sootIndex = 0.3;
    /** supports low-temperature (cool) flame chemistry — FLEX fuels */
    bool coolFlameCapable = false;
    /** supports smoldering re-ignition — cotton/Nomex-type solids */
    bool smoldering = false;
};

/**
 * Multifactor risk vector — the 4 axes the game decomposes into
 * ignition / propagation / detection / persistence. Values are 0..1
 * unless noted; computed per material+atmosphere+flow state, not
 * per material alone.
 */
struct RiskVector {
    /** ignition pressure at the atmosphere (0 at/below LOC) */
    double ignitionRisk = 0;
    /** expected flame spread at the atmosphere+flow, mm/s */
    double spreadVelocityMms = 0;
    /** chance the fire is hard to detect — cool-flame stealth */
    double coolFlameStealthIndex = 0;
    /** CO/soot accumulation pressure on crew (0..1) */
    double toxicityBuildup = 0;
};

/**
 * NASA spin-off modifiers researched by the crew. Values <1 reduce,
 * >1 amplify the physical parameter they modulate.
 */
struct TechModifiers {
    /** <1 → hidden flames breach the detection threshold sooner */
    double detectionLatencyMult = 1.0;
    /** >1 → extinguishing progress per tick is faster */
    double extinguishRateMult = 1.0;
    /** <1 → crew burn damage reduced (thermal attire) */
    double crewThermalMult = 1.0;
};

class MaterialRisk {
  public:
    MaterialRisk();

    /** replace/extend the table from a JSON document (calibration.json) */
    void loadJson(const std::string& json);

    const Material* get(const std::string& id) const;
    std::vector<Material> all() const;

    /**
     * Relative ignition pressure of a material in a given atmosphere:
     * 0 at/below LOC, rising ~quadratically above it.
     */
    static double ignitionPressure(const Material& m, double o2Pct);

    /** midpoint spread rate, cm/s */
    static double midSpread(const Material& m) {
        return 0.5 * (m.spreadMinCms + m.spreadMaxCms);
    }

    /**
     * 4-axis risk vector at (material, o2Pct, flowCms).
     * `tech` scales the detection axis (spin-off detectors).
     */
    static RiskVector riskVector(const Material& m, double o2Pct,
                                 double flowCms,
                                 const TechModifiers& tech = {});

  private:
    std::unordered_map<std::string, Material> table_;
};

} // namespace ff
