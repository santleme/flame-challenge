#include "chamber.hpp"

#include <cstdio>
#include <cstring>

namespace ff {

Chamber::Chamber() = default;
Chamber::Chamber(MaterialRisk risks) : risks_(std::move(risks)) {}

void Chamber::configure(const Config& cfg) {
    cfg_ = cfg;
    useDroplet_ = cfg.model == "droplet";
    const Material* m = risks_.get(cfg.materialId);
    const Material fallback{"pmma", "PMMA", 15.0, 0.3, 3.5, 0.35, false, false};
    const Material& mat = m ? *m : fallback;

    if (useDroplet_) {
        DropletFlame::Config c;
        c.dropletD0Mm = cfg.dropletD0Mm;
        c.o2Pct = cfg.o2Pct;
        c.pressureKpa = cfg.pressureKpa;
        c.material = mat;
        c.seed = cfg.seed;
        droplet_.configure(c);
    } else {
        SolidSpread::Config c;
        c.slabLengthCm = cfg.slabLengthCm;
        c.o2Pct = cfg.o2Pct;
        c.flowCms = cfg.flowCms;
        c.pressureKpa = cfg.pressureKpa;
        c.partialGravity = cfg.partialGravity;
        c.material = mat;
        c.o2Source = (int)cfg.o2Source;
        c.coolingApplied = cfg.coolingApplied;
        spread_.configure(c);
    }
    ignited_ = false;
    lastRegime_ = -1;
    events_.clear();
}

double Chamber::ignitionPressure() const {
    const Material* m = risks_.get(cfg_.materialId);
    if (!m) return 0.5;
    return MaterialRisk::ignitionPressure(*m, cfg_.o2Pct);
}

RiskVector Chamber::riskVector() const {
    const Material* m = risks_.get(cfg_.materialId);
    if (!m) return {};
    RiskVector rv = MaterialRisk::riskVector(*m, cfg_.o2Pct, cfg_.flowCms, mods_);
    // regime multipliers mirror SolidSpread::nominalRate so the HUD axis
    // agrees with what the solver actually does
    if (cfg_.o2Source == O2SourceType::EnrichedPressure) {
        rv.spreadVelocityMms *= 2.5;
        rv.ignitionRisk = std::min(1.0, rv.ignitionRisk * 1.4 + 0.1);
    } else if (cfg_.o2Source == O2SourceType::ChemicalGenerator) {
        rv.spreadVelocityMms *= 1.4;
        // self-oxidizing: cutting cabin O2 does not reduce toxicity load
        rv.toxicityBuildup = std::min(1.0, rv.toxicityBuildup + 0.25);
    }
    return rv;
}

void Chamber::setModifiers(const TechModifiers& mods) { mods_ = mods; }

void Chamber::applyCooling(bool on) {
    cfg_.coolingApplied = on;
    if (!useDroplet_) spread_.setCooling(on);
    if (on) events_.push_back("cooling-applied");
}

void Chamber::step(double dtSec) {
    if (useDroplet_) {
        droplet_.step(dtSec);
        const auto r = droplet_.state().regime;
        if (r == DropletFlame::Regime::HotFlame && !ignited_) {
            ignited_ = true;
            events_.push_back("ignited");
        }
        if (r == DropletFlame::Regime::CoolFlame && lastRegime_ != (int)r)
            events_.push_back("cool-flame-onset");
        if (r == DropletFlame::Regime::Extinguished && lastRegime_ != (int)r)
            events_.push_back("extinguished");
        lastRegime_ = (int)r;
    } else {
        spread_.step(dtSec);
        const auto r = spread_.state().regime;
        if (r == SolidSpread::Regime::Spreading && !ignited_) {
            ignited_ = true;
            events_.push_back("ignited");
        }
        if (r == SolidSpread::Regime::Out && lastRegime_ != (int)r)
            events_.push_back("extinguished");
        lastRegime_ = (int)r;
    }
}

int Chamber::regime() const {
    return useDroplet_ ? (int)droplet_.state().regime : (int)spread_.state().regime;
}

bool Chamber::hotBurning() const {
    return useDroplet_ ? droplet_.state().regime == DropletFlame::Regime::HotFlame
                       : spread_.state().regime == SolidSpread::Regime::Spreading;
}

bool Chamber::coolFlame() const {
    return useDroplet_ && droplet_.state().regime == DropletFlame::Regime::CoolFlame;
}

bool Chamber::finished() const {
    return useDroplet_ ? droplet_.state().regime == DropletFlame::Regime::Extinguished
                       : spread_.state().regime == SolidSpread::Regime::Out;
}

std::vector<std::string> Chamber::drainEvents() {
    auto out = std::move(events_);
    events_.clear();
    return out;
}

std::string Chamber::stateJson() const {
    char buf[1024];
    const RiskVector rv = riskVector();
    const char* riskTail =
        ",\"riskIgnition\":%.3f,\"riskSpreadMms\":%.3f,\"riskStealth\":%.3f,"
        "\"riskToxicity\":%.3f,\"o2Source\":%d,\"o2Pct\":%.1f}";
    if (useDroplet_) {
        const auto& s = droplet_.state();
        std::snprintf(
            buf, sizeof buf,
            "{\"model\":\"droplet\",\"tSec\":%.3f,\"regime\":%d,"
            "\"dropletDMm\":%.3f,\"flameRMm\":%.3f,\"flameTempK\":%.1f,"
            "\"heatReleaseW\":%.2f,\"burnFraction\":%.3f,"
            "\"ignited\":%s,\"coolFlame\":%s,\"finished\":%s",
            s.tSec, (int)s.regime, s.dropletDMm, s.flameRMm, s.flameTempK,
            s.heatReleaseW, s.burnFraction,
            ignited_ ? "true" : "false", coolFlame() ? "true" : "false",
            finished() ? "true" : "false");
        const size_t n = std::strlen(buf);
        std::snprintf(buf + n, sizeof buf - n, riskTail,
                      rv.ignitionRisk, rv.spreadVelocityMms,
                      rv.coolFlameStealthIndex, rv.toxicityBuildup,
                      (int)cfg_.o2Source, cfg_.o2Pct);
    } else {
        const auto& s = spread_.state();
        std::snprintf(
            buf, sizeof buf,
            "{\"model\":\"spread\",\"tSec\":%.3f,\"regime\":%d,"
            "\"frontPosCm\":%.3f,\"spreadRateCms\":%.3f,\"burnLengthCm\":%.3f,"
            "\"intensity\":%.3f,"
            "\"ignited\":%s,\"coolFlame\":false,\"finished\":%s",
            s.tSec, (int)s.regime, s.frontPosCm, s.spreadRateCms,
            s.burnLengthCm, s.intensity,
            ignited_ ? "true" : "false", finished() ? "true" : "false");
        const size_t n = std::strlen(buf);
        std::snprintf(buf + n, sizeof buf - n, riskTail,
                      rv.ignitionRisk, rv.spreadVelocityMms,
                      rv.coolFlameStealthIndex, rv.toxicityBuildup,
                      (int)cfg_.o2Source, cfg_.o2Pct);
    }
    return buf;
}

} // namespace ff
