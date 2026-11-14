// Emscripten embind bindings — same Chamber API for the browser client.
// Build: emcmake cmake .. -DEMSCRIPTEN=ON && emmake make ffengine_wasm
#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>

#include "chamber.hpp"
#include "material_risk.hpp"

using namespace emscripten;
using namespace ff;

namespace {
// embind can't deduce lambdas taking `const Class& self` on older emsdk —
// bind a plain free function pointer instead (instance is arg 0)
double riskIgnitionPressure(const MaterialRisk& self, const std::string& id,
                            double o2) {
    const Material* m = self.get(id);
    return m ? MaterialRisk::ignitionPressure(*m, o2) : -1.0;
}
}  // namespace

EMSCRIPTEN_BINDINGS(freefall_engine) {
    // value types returned by the collection APIs below — embind throws
    // UnboundTypeError at call time for any unregistered return type
    value_object<Material>("Material")
        .field("id", &Material::id)
        .field("name", &Material::name)
        .field("locPct", &Material::locPct)
        .field("spreadMinCms", &Material::spreadMinCms)
        .field("spreadMaxCms", &Material::spreadMaxCms)
        .field("sootIndex", &Material::sootIndex)
        .field("coolFlameCapable", &Material::coolFlameCapable)
        .field("smoldering", &Material::smoldering);

    register_vector<Material>("MaterialVector");
    register_vector<std::string>("StringVector");

    class_<MaterialRisk>("MaterialRisk")
        .constructor<>()
        .function("loadJson", &MaterialRisk::loadJson)
        .function("all", &MaterialRisk::all)
        .function("ignitionPressure", &riskIgnitionPressure);

    value_object<Chamber::Config>("ChamberConfig")
        .field("investigationId", &Chamber::Config::investigationId)
        .field("materialId", &Chamber::Config::materialId)
        .field("model", &Chamber::Config::model)
        .field("o2Pct", &Chamber::Config::o2Pct)
        .field("flowCms", &Chamber::Config::flowCms)
        .field("pressureKpa", &Chamber::Config::pressureKpa)
        .field("slabLengthCm", &Chamber::Config::slabLengthCm)
        .field("dropletD0Mm", &Chamber::Config::dropletD0Mm)
        .field("partialGravity", &Chamber::Config::partialGravity)
        .field("seed", &Chamber::Config::seed);

    class_<Chamber>("Chamber")
        .constructor<>()
        .constructor<MaterialRisk>()
        .function("configure", &Chamber::configure)
        .function("step", &Chamber::step)
        .function("updateAtmosphere", &Chamber::updateAtmosphere)
        .function("ignitionPressure", &Chamber::ignitionPressure)
        .function("regime", &Chamber::regime)
        .function("hotBurning", &Chamber::hotBurning)
        .function("coolFlame", &Chamber::coolFlame)
        .function("finished", &Chamber::finished)
        .function("stateJson", &Chamber::stateJson)
        .function("drainEvents", &Chamber::drainEvents);
}
#endif
