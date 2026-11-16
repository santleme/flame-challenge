"""SI copilot: strict contract, deterministic offline fallback, STT
degradation path. All tests run with 9Router and whisper.cpp DOWN —
the services must degrade, never fail."""
from __future__ import annotations

import io
import json

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.services import si_copilot as si

client = TestClient(app)

STATE = {"materialId": "cotton", "o2Pct": 30.0, "flowCms": 20.0,
         "gravity": "microgravity", "investigationId": "saffire"}


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    """Guarantee the gateway is 'down' regardless of local services."""
    monkeypatch.setattr(si, "_llm_client", lambda: None)


def test_chat_offline_contract():
    r = client.post("/api/si/chat",
                    json={"message": "what should we do about the fire?",
                          "current_chamber_state": STATE})
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "offline-fallback"
    assert j["recommended_action"] in si.ACTION_CODES
    assert j["briefing"]
    assert j["engine"] in ("c++", "python-fallback")
    # evidence = the 3 nearest consolidated-sheet runs
    assert 1 <= len(j["evidence"]) <= 3
    assert all("accession" in e and "runId" in e for e in j["evidence"])
    # chamber echo resolves the material through the investigation spec
    assert j["chamber"]["materialId"] == "cotton"
    assert 0.0 <= j["chamber"]["riskIndex"] <= 1.0


def test_chat_forced_flow_high_o2_cuts_ventilation():
    r = client.post("/api/si/chat",
                    json={"message": "fire signature!",
                          "current_chamber_state": STATE})
    j = r.json()
    assert j["recommended_action"] == "CUT_VENTILATION"
    assert j["ui_command"]["set_airflow_cm_s"] == 0.0


def test_chat_below_loc_suppresses_locally():
    st = {**STATE, "o2Pct": 10.0, "flowCms": 0.0}
    r = client.post("/api/si/chat",
                    json={"message": "status?", "current_chamber_state": st})
    j = r.json()
    assert j["recommended_action"] == "SUPPRESS_LOCAL"
    assert j["chamber"]["level"] in ("minimal", "low")


def test_chat_high_margin_reduces_o2():
    st = {**STATE, "o2Pct": 35.0, "flowCms": 0.0}
    r = client.post("/api/si/chat",
                    json={"message": "bring risk down",
                          "current_chamber_state": st})
    j = r.json()
    assert j["recommended_action"] in ("REDUCE_O2", "COOL_AND_ISOLATE")
    if j["ui_command"] and j["ui_command"].get("set_o2_percent") is not None:
        assert j["ui_command"]["set_o2_percent"] < 35.0


def test_retuned_commands_rescore_chamber():
    """Commands that retune the run change the evaluated point — the
    chamber block must describe the post-command scenario, not the stale
    sent state (reports label what was actually run)."""
    r = client.post("/api/si/chat",
                    json={"message": "fire signature!",
                          "current_chamber_state": STATE})
    j = r.json()
    # policy cut the 20 cm/s flow — chamber echoes the executed point
    assert j["simulation_commands"]["set_airflow_cm_s"] == 0.0
    assert j["chamber"]["flowCms"] == 0.0
    assert j["chamber"]["materialId"] == "cotton"


def test_llm_commands_rescore_chamber(monkeypatch):
    """LLM preset+gravity commands → chamber scored at the new point, not
    the incoming chamber."""
    payload = {
        "briefing": "switching rigs",
        "recommended_action": "SUPPRESS_LOCAL",
        "simulation_commands": {"load_preset": "flex-2",
                                 "set_gravity_g": 0.17},
    }

    class _Msg:
        content = json.dumps(payload)

    class _Choice:
        message = _Msg()

    class _Completion:
        choices = [_Choice()]

    class _Completions:
        async def create(self, **kwargs):
            return _Completion()

    class _Chat:
        completions = _Completions()

    class _Stub:
        chat = _Chat()

    monkeypatch.setattr(si, "_llm_client", lambda: _Stub())
    r = client.post("/api/si/chat",
                    json={"message": "run flex on the moon",
                          "current_chamber_state": STATE})
    j = r.json()
    assert j["mode"] == "llm"
    assert j["chamber"]["investigationId"] == "flex-2"
    assert j["chamber"]["materialId"] == "heptane"
    assert j["chamber"]["gravity"] == "lunar"


def test_chat_validation_422():
    r = client.post("/api/si/chat",
                    json={"message": "hi",
                          "current_chamber_state": {"o2Pct": 250}})
    assert r.status_code == 422
    r = client.post("/api/si/chat", json={"current_chamber_state": {}})
    assert r.status_code == 422


def test_chat_default_state_ok():
    r = client.post("/api/si/chat", json={"message": "status report"})
    assert r.status_code == 200
    assert r.json()["chamber"]["materialId"] == "pmma"


def test_voice_stt_offline_degrades():
    r = client.post(
        "/api/si/voice",
        files={"audio": ("clip.webm", io.BytesIO(b"fake-webm-bytes"),
                         "audio/webm")},
        data={"state": json.dumps(STATE)})
    assert r.status_code == 200
    j = r.json()
    assert j["stt"] == "offline"
    assert j["transcript"] is None
    # deterministic response still present — the console never dead-ends
    assert j["response"]["recommended_action"] in si.ACTION_CODES


def test_voice_bad_state_422():
    r = client.post(
        "/api/si/voice",
        files={"audio": ("clip.webm", io.BytesIO(b"x"), "audio/webm")},
        data={"state": "{not json"})
    assert r.status_code == 422


# ---------- /api/si/voice-command — flat voice-first envelope ----------

def test_voice_command_offline_flat_contract():
    """whisper.cpp down → deterministic answer in the flat voice-command
    envelope — navigation + simulation_commands always present keys."""
    r = client.post(
        "/api/si/voice-command",
        files={"audio": ("clip.wav", io.BytesIO(b"fake-wav"), "audio/wav")},
        data={"state": json.dumps(STATE)})
    assert r.status_code == 200
    j = r.json()
    assert j["stt"] == "offline"
    assert j["transcript"] is None
    assert j["recommended_action"] in si.ACTION_CODES
    # flat envelope — the keys the HUD binds to
    assert "briefing" in j and "navigation" in j
    assert "simulation_commands" in j and "ui_command" in j
    assert j["mode"] == "offline-fallback"


def test_voice_command_containment_mirrors_action():
    """High-flow high-O2 state → the offline policy cuts ventilation; the
    voice contract must expose it as an executable containment command."""
    r = client.post(
        "/api/si/voice-command",
        files={"audio": ("clip.wav", io.BytesIO(b"fake-wav"), "audio/wav")},
        data={"state": json.dumps(STATE)})  # 30% o2 · 20 cm/s
    j = r.json()
    assert j["recommended_action"] == "CUT_VENTILATION"
    assert j["ui_command"]["set_airflow_cm_s"] == 0.0
    sim = j["simulation_commands"]
    assert sim is not None
    assert sim["trigger_containment"] == "CUT_VENTILATION"
    assert sim["set_airflow_cm_s"] == 0.0
    # offline policy that acts on the sim navigates to the chamber
    assert j["navigation"]["scroll_to_section"] == "chamber"


def test_voice_command_bad_state_422():
    r = client.post(
        "/api/si/voice-command",
        files={"audio": ("clip.wav", io.BytesIO(b"x"), "audio/wav")},
        data={"state": "{oops"})
    assert r.status_code == 422


def test_normalize_llm_simulation_commands_fills_ui():
    """An LLM that only emits the voice surface still produces a working
    ui_command for the console."""
    resp = si.CopilotResponse(
        briefing="cut flow now",
        recommended_action="CUT_VENTILATION",
        simulation_commands={
            "set_airflow_cm_s": 0.0,
            "trigger_containment": "CUT_VENTILATION",
        },
    ).normalize()
    assert resp.ui_command is not None
    assert resp.ui_command.set_airflow_cm_s == 0.0


def test_normalize_ui_command_fills_simulation():
    """Legacy ui_command-only answers (LLM ignores the new keys) still
    surface the executable voice contract."""
    resp = si.CopilotResponse(
        briefing="drop o2",
        recommended_action="REDUCE_O2",
        ui_command={"set_o2_percent": 18.0},
    ).normalize()
    sim = resp.simulation_commands
    assert sim is not None
    assert sim.set_o2_percent == 18.0
    assert sim.trigger_containment == "REDUCE_O2"


def test_normalize_focus_only_command_fires_no_containment():
    """A focus_module-only ui tunes nothing — mirroring it as
    trigger_containment would fire suppression for a camera move."""
    resp = si.CopilotResponse(
        briefing="camera on lab",
        recommended_action="SUPPRESS_LOCAL",
        ui_command={"focus_module": "lab"},
    ).normalize()
    assert resp.simulation_commands is None


def test_normalize_canonicalizes_ui_preset_alias():
    """Spoken aliases must resolve on BOTH surfaces — SiConsole looks
    ui_command.load_preset up in its canonical spec table."""
    resp = si.CopilotResponse(
        briefing="load flex",
        recommended_action="SUPPRESS_LOCAL",
        ui_command={"load_preset": "FLEX"},
    ).normalize()
    assert resp.ui_command.load_preset == "flex-2"
    assert resp.simulation_commands.load_preset == "flex-2"


def test_normalize_simulation_preset_wins_conflict():
    """Both surfaces supplied with different presets — the executable
    surface is authoritative."""
    resp = si.CopilotResponse(
        briefing="run bass",
        recommended_action="SUPPRESS_LOCAL",
        ui_command={"load_preset": "saffire"},
        simulation_commands={"load_preset": "BASS_II"},
    ).normalize()
    assert resp.ui_command.load_preset == "bass-ii"


def test_offline_below_loc_focus_emits_no_nav():
    """Below-LOC with a module focus: the ui holds only a camera hint —
    no containment, no chamber scroll."""
    st = {**STATE, "o2Pct": 10.0, "flowCms": 0.0, "module": "lab"}
    r = client.post("/api/si/chat",
                    json={"message": "status?", "current_chamber_state": st})
    j = r.json()
    assert j["recommended_action"] == "SUPPRESS_LOCAL"
    assert j["simulation_commands"] is None
    assert j["navigation"] is None


def test_preset_alias_resolution():
    assert si.resolve_preset("FLEX") == "flex-2"
    assert si.resolve_preset("saffire") == "saffire"
    assert si.resolve_preset("ACME_EFIELD") == "acme"
    assert si.resolve_preset("SAME_R") == "same"
    # historical scenarios are not chamber rigs
    assert si.resolve_preset("MIR_1997") is None
    assert si.resolve_preset("APOLLO_1") is None
    assert si.resolve_preset("not-a-rig") is None


def test_simulation_commands_validators():
    sim = si.SimulationCommands(load_preset="FLEX",
                                trigger_containment="reduce_o2")
    assert sim.load_preset == "flex-2"
    assert sim.trigger_containment == "REDUCE_O2"
    with pytest.raises(Exception):
        si.SimulationCommands(trigger_containment="VENT_EVERYTHING")


def test_gravity_regime_mapping():
    assert si.gravity_regime(0.0) == "microgravity"
    assert si.gravity_regime(0.17) == "lunar"
    assert si.gravity_regime(0.38) == "martian"
    assert si.gravity_regime(1.0) == "earth"


def test_llm_malformed_json_falls_back(monkeypatch):
    """A reachable gateway returning garbage must not reach the client."""
    class _Msg:
        content = "definitely not json"

    class _Choice:
        message = _Msg()

    class _Completion:
        choices = [_Choice()]

    class _Completions:
        async def create(self, **kwargs):
            return _Completion()

    class _Chat:
        completions = _Completions()

    class _Stub:
        chat = _Chat()

    monkeypatch.setattr(si, "_llm_client", lambda: _Stub())
    r = client.post("/api/si/chat",
                    json={"message": "status",
                          "current_chamber_state": STATE})
    j = r.json()
    assert j["mode"] == "offline-fallback"
    assert j["recommended_action"] in si.ACTION_CODES


def test_llm_valid_json_passes_through(monkeypatch):
    payload = {
        "briefing": "SAFFIRE regime — cut the forced flow first.",
        "recommended_action": "cut_ventilation",  # coerced to code
        "ui_command": {"set_airflow_cm_s": 0.0},
    }

    class _Msg:
        content = json.dumps(payload)

    class _Choice:
        message = _Msg()

    class _Completion:
        choices = [_Choice()]

    class _Completions:
        async def create(self, **kwargs):
            return _Completion()

    class _Chat:
        completions = _Completions()

    class _Stub:
        chat = _Chat()

    monkeypatch.setattr(si, "_llm_client", lambda: _Stub())
    r = client.post("/api/si/chat",
                    json={"message": "contain it",
                          "current_chamber_state": STATE})
    j = r.json()
    assert j["mode"] == "llm"
    assert j["recommended_action"] == "CUT_VENTILATION"
    assert j["ui_command"]["set_airflow_cm_s"] == 0.0
    assert j["evidence"]  # packet still attached for provenance
