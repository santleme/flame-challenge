#include "chamber.hpp"

#include <algorithm>
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
        spread_.configure(c);
    }
    ignited_ = false;
    lastRegime_ = -1;
    events_.clear();
}

void Chamber::updateAtmosphere(double o2Pct, double flowCms, double pressureKpa) {
    // clamp here so the public state (ignitionPressure, config()) never
    // reports unphysical values; the sub-models clamp independently
    cfg_.o2Pct = std::clamp(o2Pct, 0.0, 100.0);
    cfg_.flowCms = std::max(0.0, flowCms);
    cfg_.pressureKpa = std::max(0.0, pressureKpa);
    droplet_.updateAtmosphere(cfg_.o2Pct, cfg_.pressureKpa);
    spread_.updateAtmosphere(cfg_.o2Pct, cfg_.flowCms, cfg_.pressureKpa);
}

double Chamber::ignitionPressure() const {
    const Material* m = risks_.get(cfg_.materialId);
    if (!m) return 0.5;
    return MaterialRisk::ignitionPressure(*m, cfg_.o2Pct);
}

void Chamber::step(double dtSec) {
    if (useDroplet_) {
        droplet_.step(dtSec);
        const auto r = droplet_.state().regime;
        if (r == DropletFlame::Regime::HotFlame && !ignited_) {
            ignited_ = true;
            events_.push_back("ignited");
        } else if (r == DropletFlame::Regime::HotFlame &&
                   lastRegime_ == (int)DropletFlame::Regime::CoolFlame) {
            events_.push_back("reignited");
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
    // buffer doubles until the payload fits — no fixed-size ceiling to
    // outgrow when fields are added
    auto emit = [&](const char* fmt, auto... args) {
        std::string out;
        for (size_t cap = 512; cap <= (1u << 20); cap *= 2) {
            out.assign(cap, '\0');
            const int n = std::snprintf(out.data(), cap, fmt, args...);
            if (n >= 0 && static_cast<size_t>(n) < cap) {
                out.resize(static_cast<size_t>(n));
                return out;
            }
            if (n < 0) return std::string("{}");  // encoding failure — no hang
        }
        return out;
    };
    if (useDroplet_) {
        const auto& s = droplet_.state();
        return emit(
            "{\"model\":\"droplet\",\"tSec\":%.3f,\"regime\":%d,"
            "\"dropletDMm\":%.3f,\"flameRMm\":%.3f,\"flameTempK\":%.1f,"
            "\"heatReleaseW\":%.2f,\"burnFraction\":%.3f,"
            "\"ignited\":%s,\"coolFlame\":%s,\"finished\":%s}",
            s.tSec, (int)s.regime, s.dropletDMm, s.flameRMm, s.flameTempK,
            s.heatReleaseW, s.burnFraction,
            ignited_ ? "true" : "false", coolFlame() ? "true" : "false",
            finished() ? "true" : "false");
    }
    const auto& s = spread_.state();
    return emit(
        "{\"model\":\"spread\",\"tSec\":%.3f,\"regime\":%d,"
        "\"frontPosCm\":%.3f,\"spreadRateCms\":%.3f,\"burnLengthCm\":%.3f,"
        "\"intensity\":%.3f,"
        "\"ignited\":%s,\"coolFlame\":false,\"finished\":%s}",
        s.tSec, (int)s.regime, s.frontPosCm, s.spreadRateCms,
        s.burnLengthCm, s.intensity,
        ignited_ ? "true" : "false", finished() ? "true" : "false");
}

} // namespace ff
