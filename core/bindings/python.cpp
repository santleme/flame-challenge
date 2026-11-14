#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include "chamber.hpp"
#include "material_risk.hpp"

namespace py = pybind11;
using namespace ff;

PYBIND11_MODULE(freefall_engine, m) {
    m.doc() = "Freefall Foundry — reduced-order microgravity combustion engine "
              "(d²-law droplets, SAFFIRE-type spread, ACME material risk)";

    py::class_<Material>(m, "Material")
        .def_readonly("id", &Material::id)
        .def_readonly("name", &Material::name)
        .def_readonly("locPct", &Material::locPct)
        .def_readonly("spreadMinCms", &Material::spreadMinCms)
        .def_readonly("spreadMaxCms", &Material::spreadMaxCms)
        .def_readonly("sootIndex", &Material::sootIndex)
        .def_readonly("coolFlameCapable", &Material::coolFlameCapable)
        .def_readonly("smoldering", &Material::smoldering);

    py::class_<MaterialRisk>(m, "MaterialRisk")
        .def(py::init<>())
        .def("load_json", &MaterialRisk::loadJson)
        .def("all", &MaterialRisk::all)
        .def("ignition_pressure", [](const MaterialRisk& self,
                                     const std::string& id, double o2) {
            const Material* m = self.get(id);
            return m ? MaterialRisk::ignitionPressure(*m, o2) : -1.0;
        })
        .def("risk_vector", [](const MaterialRisk& self, const std::string& id,
                               double o2, double flow, const TechModifiers& t) {
            const Material* m = self.get(id);
            return m ? MaterialRisk::riskVector(*m, o2, flow, t) : RiskVector{};
        });

    py::class_<RiskVector>(m, "RiskVector")
        .def(py::init<>())
        .def_readonly("ignition_risk", &RiskVector::ignitionRisk)
        .def_readonly("spread_velocity_mm_s", &RiskVector::spreadVelocityMms)
        .def_readonly("cool_flame_stealth_index",
                      &RiskVector::coolFlameStealthIndex)
        .def_readonly("toxicity_buildup", &RiskVector::toxicityBuildup);

    py::class_<TechModifiers>(m, "TechModifiers")
        .def(py::init<>())
        .def_readwrite("detection_latency_mult",
                       &TechModifiers::detectionLatencyMult)
        .def_readwrite("extinguish_rate_mult",
                       &TechModifiers::extinguishRateMult)
        .def_readwrite("crew_thermal_mult", &TechModifiers::crewThermalMult);

    py::enum_<O2SourceType>(m, "O2SourceType")
        .value("AMBIENT_CABIN", O2SourceType::AmbientCabin)
        .value("ENRICHED_PRESSURE", O2SourceType::EnrichedPressure)
        .value("CHEMICAL_GENERATOR", O2SourceType::ChemicalGenerator)
        .export_values();

    py::class_<Chamber::Config>(m, "ChamberConfig")
        .def(py::init<>())
        .def_readwrite("investigationId", &Chamber::Config::investigationId)
        .def_readwrite("materialId", &Chamber::Config::materialId)
        .def_readwrite("model", &Chamber::Config::model)
        .def_readwrite("o2Pct", &Chamber::Config::o2Pct)
        .def_readwrite("flowCms", &Chamber::Config::flowCms)
        .def_readwrite("pressureKpa", &Chamber::Config::pressureKpa)
        .def_readwrite("slabLengthCm", &Chamber::Config::slabLengthCm)
        .def_readwrite("dropletD0Mm", &Chamber::Config::dropletD0Mm)
        .def_readwrite("partialGravity", &Chamber::Config::partialGravity)
        .def_readwrite("seed", &Chamber::Config::seed)
        .def_readwrite("o2Source", &Chamber::Config::o2Source)
        .def_readwrite("coolingApplied", &Chamber::Config::coolingApplied);

    py::class_<Chamber>(m, "Chamber")
        .def(py::init<>())
        .def(py::init<MaterialRisk>())
        .def("configure", &Chamber::configure)
        .def("step", &Chamber::step)
        .def("ignition_pressure", &Chamber::ignitionPressure)
        .def("risk_vector", &Chamber::riskVector)
        .def("set_modifiers", &Chamber::setModifiers)
        .def("apply_cooling", &Chamber::applyCooling)
        .def("regime", &Chamber::regime)
        .def("hot_burning", &Chamber::hotBurning)
        .def("cool_flame", &Chamber::coolFlame)
        .def("finished", &Chamber::finished)
        .def("state_json", &Chamber::stateJson)
        .def("drain_events", &Chamber::drainEvents);
}
