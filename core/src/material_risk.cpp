#include "material_risk.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>

namespace ff {

MaterialRisk::MaterialRisk() {
    // starter table — representative values compiled from public PSI
    // investigation summaries; calibrated by data-pipeline.
    const Material base[] = {
        {"heptane", "n-Heptane droplet", 12.0, 0.0, 0.0, 0.55, true, false},
        {"methanol", "Methanol droplet", 12.5, 0.0, 0.0, 0.10, true, false},
        {"pmma", "PMMA (acrylic)", 15.0, 0.3, 3.5, 0.35, false, false},
        {"pmma-sphere", "PMMA sphere", 17.0, 0.2, 4.0, 0.35, false, true},
        {"cotton", "Cotton fabric", 17.0, 0.3, 4.0, 0.20, false, true},
        {"nomex", "Nomex", 21.0, 0.2, 2.5, 0.15, false, true},
        {"polycarbonate", "Polycarbonate", 19.0, 0.2, 3.0, 0.60, false, false},
        {"card-gas", "Cardboard gas phase", 16.0, 0.4, 5.0, 0.30, false, true},
    };
    for (const auto& m : base) table_[m.id] = m;
}

const Material* MaterialRisk::get(const std::string& id) const {
    auto it = table_.find(id);
    return it == table_.end() ? nullptr : &it->second;
}

std::vector<Material> MaterialRisk::all() const {
    std::vector<Material> out;
    out.reserve(table_.size());
    for (const auto& [k, v] : table_) out.push_back(v);
    return out;
}

double MaterialRisk::ignitionPressure(const Material& m, double o2Pct) {
    const double margin = o2Pct - m.locPct;
    if (margin <= 0) {
        // µg caveat: flames can persist slightly below Earth LOC (SoFIE) —
        // retain a small residual pressure instead of a hard zero.
        return margin > -3.0 ? 0.04 : 0.0;
    }
    return std::min(1.0, 0.04 + 0.055 * std::pow(margin, 1.35));
}

RiskVector MaterialRisk::riskVector(const Material& m, double o2Pct,
                                    double flowCms, const TechModifiers& tech) {
    RiskVector v;
    v.ignitionRisk = ignitionPressure(m, o2Pct);

    // propagation axis — same interpolation the SolidSpread solver uses:
    // mid-range rate scaled by O₂ margin then boosted by forced flow
    // (SAFFIRE opposed-flow enhancement), converted to mm/s for the UI.
    const double margin = std::max(0.0, o2Pct - m.locPct);
    const double span = std::max(0.01, m.spreadMaxCms - m.spreadMinCms);
    const double o2Frac = std::clamp(margin / 25.0, 0.0, 1.0);
    double rate = m.spreadMinCms + span * std::pow(o2Frac, 0.8);
    rate *= 1.0 + std::clamp(flowCms / 20.0, 0.0, 1.5);
    v.spreadVelocityMms = rate * 10.0;

    // detection axis — FLEX cool flames and detection-gap materials
    // hide combustion from crew/alarms; detectors shrink it.
    const double detectBase =
        0.1 + (m.coolFlameCapable ? 0.6 : 0.0) + (m.smoldering ? 0.15 : 0.0);
    v.coolFlameStealthIndex =
        std::clamp(detectBase * tech.detectionLatencyMult, 0.0, 1.0);

    // persistence/toxicity axis — soot index drives CO/aerosol load;
    // smoldering extends the re-ignition window after knock-down.
    const double persistence =
        0.1 + (m.smoldering ? 0.55 : 0.0) +
        (m.locPct < 14.0 ? 0.2 : 0.0); // low-LOC fuels persist at low O₂
    v.toxicityBuildup = std::clamp(m.sootIndex * 0.5 + persistence * 0.5, 0.0, 1.0);
    return v;
}

// ---- minimal JSON reader (no external deps) ----
// expects: {"materials":[{...},...]} with flat scalar fields.
// Only tolerant parsing needed for our own calibration output.

static std::string trim(std::string s) {
    auto notspace = [](int c) { return !std::isspace(c); };
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), notspace));
    s.erase(std::find_if(s.rbegin(), s.rend(), notspace).base(), s.end());
    return s;
}

static bool extractString(const std::string& obj, const std::string& key, std::string& out) {
    const std::string pat = "\"" + key + "\"";
    auto p = obj.find(pat);
    if (p == std::string::npos) return false;
    p = obj.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    auto q1 = obj.find('"', p + 1);
    auto q2 = q1 == std::string::npos ? q1 : obj.find('"', q1 + 1);
    if (q1 == std::string::npos || q2 == std::string::npos) return false;
    out = obj.substr(q1 + 1, q2 - q1 - 1);
    return true;
}

static bool extractNumber(const std::string& obj, const std::string& key, double& out) {
    const std::string pat = "\"" + key + "\"";
    auto p = obj.find(pat);
    if (p == std::string::npos) return false;
    p = obj.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    try {
        out = std::stod(trim(obj.substr(p + 1, obj.find_first_of(",}", p) - p - 1)));
    } catch (...) {
        return false;
    }
    return true;
}

static bool extractBool(const std::string& obj, const std::string& key, bool& out) {
    const std::string pat = "\"" + key + "\"";
    auto p = obj.find(pat);
    if (p == std::string::npos) return false;
    p = obj.find(':', p + pat.size());
    if (p == std::string::npos) return false;
    auto v = trim(obj.substr(p + 1, obj.find_first_of(",}", p) - p - 1));
    out = v.rfind("true", 0) == 0;
    return true;
}

void MaterialRisk::loadJson(const std::string& json) {
    // split on top-level object boundaries inside "materials" array
    auto pos = json.find("\"materials\"");
    if (pos == std::string::npos) return;
    pos = json.find('[', pos);
    if (pos == std::string::npos) return;

    size_t depth = 0;
    size_t objStart = std::string::npos;
    for (size_t i = pos; i < json.size(); ++i) {
        const char c = json[i];
        if (c == '{') {
            if (depth++ == 0) objStart = i;
        } else if (c == '}') {
            if (--depth == 0 && objStart != std::string::npos) {
                const std::string obj = json.substr(objStart, i - objStart + 1);
                Material m;
                std::string id;
                if (!extractString(obj, "id", id)) continue;
                m = table_.count(id) ? table_[id] : Material{};
                m.id = id;
                extractString(obj, "name", m.name);
                extractNumber(obj, "locPct", m.locPct);
                extractNumber(obj, "spreadMinCms", m.spreadMinCms);
                extractNumber(obj, "spreadMaxCms", m.spreadMaxCms);
                extractNumber(obj, "sootIndex", m.sootIndex);
                extractBool(obj, "coolFlameCapable", m.coolFlameCapable);
                extractBool(obj, "smoldering", m.smoldering);
                table_[id] = m;
                objStart = std::string::npos;
            }
        } else if (c == ']' && depth == 0) {
            break;
        }
    }
}

} // namespace ff
