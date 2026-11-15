#include "material_risk.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>

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
    // flames are never observed sustaining burn more than ~3pp below LOC
    // — a hard dead band regardless of the fitted curve
    if (margin <= -3.0) return 0.0;
    if (m.ignitionFitN > 0.0) {
        // PSI logistic fit: measured P(sustained burn | margin), fitted
        // per material or pooled over its fuel family (fit_risk_model.py)
        const double z = std::clamp(
            m.ignitionLogitA + m.ignitionLogitB * margin, -30.0, 30.0);
        return 1.0 / (1.0 + std::exp(-z));
    }
    if (margin <= 0) {
        // µg caveat: flames can persist slightly below Earth LOC (SoFIE) —
        // retain a small residual pressure instead of a hard zero.
        return 0.04;
    }
    return std::min(1.0, 0.04 + 0.055 * std::pow(margin, 1.35));
}

// ventilation anchors (cm/s -> factor) — mirrors FLOW_ANCHORS in
// calibrate_constants.py; loadJson("flowAnchors") overrides so the
// pipeline owns the canonical table
static std::vector<std::pair<double, double>> g_flowAnchors = {
    {0.0, 0.80}, {2.0, 0.90}, {8.0, 1.05}, {18.0, 1.15},
    {40.0, 1.00}, {80.0, 0.70}, {150.0, 0.45},
};

double MaterialRisk::flowFactor(double flowCms) {
    const double f = std::max(0.0, flowCms);
    if (f <= g_flowAnchors.front().first) return g_flowAnchors.front().second;
    for (size_t i = 0; i + 1 < g_flowAnchors.size(); ++i) {
        const auto& [x0, y0] = g_flowAnchors[i];
        const auto& [x1, y1] = g_flowAnchors[i + 1];
        if (f <= x1) return y0 + (y1 - y0) * (f - x0) / (x1 - x0);
    }
    return g_flowAnchors.back().second;
}

double MaterialRisk::hiddenFactor(const Material& m) {
    // same composite as fit_risk_model.py hiddenFactor
    return 1.0 + 0.25 * (m.coolFlameCapable ? 1.0 : 0.0)
              + 0.15 * (m.smoldering ? 1.0 : 0.0)
              + 0.10 * m.sootIndex;
}

double MaterialRisk::gravityFactor(const std::string& gravity) {
    std::string g;
    g.reserve(gravity.size());
    for (unsigned char c : gravity) g += static_cast<char>(std::tolower(c));
    // services/risk.py GRAVITY_FACTOR — µg reference = 1.0 (worst case)
    if (g == "lunar") return 0.92;
    if (g == "martian" || g == "mars") return 0.95;
    if (g == "partial-gravity") return 0.94;
    if (g == "earth") return 0.85;
    return 1.0;
}

RiskBreakdown MaterialRisk::riskBreakdown(const Material& m, double o2Pct,
                                          double flowCms,
                                          const std::string& gravity) {
    RiskBreakdown d;
    d.ignitionPressure = ignitionPressure(m, o2Pct);
    d.flowFactor = flowFactor(flowCms);
    d.hiddenFactor = hiddenFactor(m);
    d.gravityFactor = gravityFactor(gravity);
    d.riskIndex = std::clamp(d.ignitionPressure * d.flowFactor
                             * d.hiddenFactor * d.gravityFactor, 0.0, 1.0);
    return d;
}

double MaterialRisk::riskIndex(const Material& m, double o2Pct,
                               double flowCms, const std::string& gravity) {
    return riskBreakdown(m, o2Pct, flowCms, gravity).riskIndex;
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

// parse "flowAnchors":[[x,y],...] — a top-level array of number pairs.
// Tolerant like the rest of this reader: malformed entries are skipped.
static void parseFlowAnchors(const std::string& json) {
    auto pos = json.find("\"flowAnchors\"");
    if (pos == std::string::npos) return;
    pos = json.find('[', pos);
    if (pos == std::string::npos) return;
    std::vector<std::pair<double, double>> anchors;
    int depth = 0;
    for (size_t i = pos + 1; i < json.size(); ++i) {
        const char c = json[i];
        if (c == '[') {
            ++depth;
            char* end = nullptr;
            const double x = std::strtod(json.c_str() + i + 1, &end);
            if (end == json.c_str() + i + 1) continue;
            while (*end == ' ' || *end == ',') ++end;
            char* e2 = nullptr;
            const double y = std::strtod(end, &e2);
            if (e2 == end) continue;
            anchors.emplace_back(x, y);
        } else if (c == ']') {
            if (--depth < 0) break;   // closing bracket of the outer array
        }
    }
    if (anchors.size() >= 2) g_flowAnchors = std::move(anchors);
}

// parse "coflow":{ "<fuel>": {ignO2Pct, minFlowMgs, extO2Pct, rateCrit,
// fitN, fitAccuracy}, ... } — fitted ACME extinction constants,
// fit_risk_model.py is the only writer; rateCrit null/absent disables
// the fuel-ramp branch
static void parseCoflow(const std::string& json,
                        std::unordered_map<std::string, CoflowFit>& out) {
    // the literal "coflow" also appears as a *value* ("model": "coflow")
    // inside investigation specs — only accept the key followed by ':' '{'
    size_t pos = 0;
    while (true) {
        pos = json.find("\"coflow\"", pos);
        if (pos == std::string::npos) return;
        size_t p = json.find_first_not_of(" \t\r\n", pos + 8);
        if (p != std::string::npos && json[p] == ':') {
            p = json.find_first_not_of(" \t\r\n", p + 1);
            if (p != std::string::npos && json[p] == '{') {
                pos = p;
                break;
            }
        }
        pos += 8;
    }
    size_t end = pos + 1, depth = 1;
    while (end < json.size() && depth) {
        if (json[end] == '{') ++depth;
        else if (json[end] == '}') --depth;
        ++end;
    }
    const std::string body = json.substr(pos + 1, end - pos - 2);
    size_t i = 0;
    while (true) {
        auto k1 = body.find('"', i);
        if (k1 == std::string::npos) break;
        auto k2 = body.find('"', k1 + 1);
        if (k2 == std::string::npos) break;
        auto colon = body.find(':', k2);
        auto brace = body.find('{', k2);
        if (colon == std::string::npos || brace == std::string::npos
                || colon > brace) {
            i = k2 + 1;
            continue;
        }
        size_t d = 1, e = brace + 1;
        while (e < body.size() && d) {
            if (body[e] == '{') ++d;
            else if (body[e] == '}') --d;
            ++e;
        }
        const std::string fuel = body.substr(k1 + 1, k2 - k1 - 1);
        const std::string obj = body.substr(brace, e - brace);
        CoflowFit f;
        extractNumber(obj, "ignO2Pct", f.ignO2Pct);
        extractNumber(obj, "minFlowMgs", f.minFlowMgs);
        extractNumber(obj, "extO2Pct", f.extO2Pct);
        extractNumber(obj, "rateCrit", f.rateCrit);
        double n = 0.0, acc = 0.0;
        extractNumber(obj, "fitN", n);
        extractNumber(obj, "fitAccuracy", acc);
        f.fitN = static_cast<int>(n);
        f.fitAccuracy = acc;
        out[fuel] = f;
        i = e;
    }
}

const CoflowFit* MaterialRisk::coflow(const std::string& fuel) const {
    auto it = coflow_.find(fuel);
    if (it != coflow_.end()) return &it->second;
    it = coflow_.find("_default");
    return it != coflow_.end() ? &it->second : nullptr;
}

CoflowOutcome MaterialRisk::coflowOutcome(const std::string& fuel,
                                          double o2Pct, double o2EndPct,
                                          double mfLo, double mfHi,
                                          double burnTimeS) const {
    const CoflowFit* p = coflow(fuel);
    if (!p) return CoflowOutcome::NoIgnition;
    // negative = field absent in the source row; skip that gate
    if (o2Pct >= 0 && o2Pct < p->ignO2Pct) return CoflowOutcome::NoIgnition;
    if (mfHi >= 0 && mfHi < p->minFlowMgs) return CoflowOutcome::NoIgnition;
    if (o2EndPct >= 0 && o2EndPct < p->extO2Pct)
        return CoflowOutcome::Extinction;
    if (p->rateCrit > 0 && mfLo >= 0 && mfHi >= 0 && burnTimeS > 0
            && mfHi > mfLo && (mfHi - mfLo) / burnTimeS > p->rateCrit)
        return CoflowOutcome::Extinction;
    return CoflowOutcome::Burn;
}

void MaterialRisk::loadJson(const std::string& json) {
    parseFlowAnchors(json);
    parseCoflow(json, coflow_);
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
                extractNumber(obj, "burnRateK0Mm2s", m.burnRateK0Mm2s);
                extractNumber(obj, "burnRateKO2Mm2sPct", m.burnRateKO2Mm2sPct);
                extractNumber(obj, "extinctionDHotMm", m.extinctionDHotMm);
                extractNumber(obj, "extinctionDMinMm", m.extinctionDMinMm);
                extractNumber(obj, "ignitionLogitA", m.ignitionLogitA);
                extractNumber(obj, "ignitionLogitB", m.ignitionLogitB);
                extractNumber(obj, "ignitionFitN", m.ignitionFitN);
                table_[id] = m;
                objStart = std::string::npos;
            }
        } else if (c == ']' && depth == 0) {
            break;
        }
    }
}

} // namespace ff
