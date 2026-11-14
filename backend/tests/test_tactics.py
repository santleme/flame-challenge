"""Tests for backend.services.tactics — the deterministic synthesizer."""
from __future__ import annotations

from backend.services import tactics


def _card(cards: list[dict], cid: str) -> dict:
    return next(c for c in cards if c["id"] == cid)


def test_decision_cards_shape():
    out = tactics.decision_cards("cotton", 21.6, 20.0)
    assert set(out) >= {"material", "briefing", "neighbors", "cards"}
    assert len(out["cards"]) == 3
    for card in out["cards"]:
        for key in ("id", "context", "question", "preset", "metric",
                    "options", "sources", "neighbors"):
            assert key in card
        for o in card["options"]:
            assert 0 <= o["score"] <= 100
            assert set(o["model"]) >= {"materialId", "o2Pct", "flowCms"}


def test_cut_ventilation_beats_forced_flow():
    """SAFFIRE physics: at duct-flow rates, killing the fan must score
    strictly better containment than keeping it."""
    out = tactics.decision_cards("cotton", 21.6, 20.0)
    card = _card(out["cards"], "containment")
    cut = next(o for o in card["options"] if "Cut" in o["label"])
    keep = next(o for o in card["options"] if "Keep" in o["label"])
    assert cut["score"] > keep["score"]


def test_below_loc_scores_near_perfect():
    out = tactics.decision_cards("cotton", 30.0, 0.0)
    card = _card(out["cards"], "atmosphere")
    below = next(o for o in card["options"] if "below LOC" in o["label"])
    hold = next(o for o in card["options"] if "Hold" in o["label"])
    assert below["score"] >= 90
    assert below["score"] > hold["score"]


def test_suppression_degrades_on_smoldering_material():
    """Smolder-capable cotton must price inert-gas suppression lower
    than a non-smoldering gas (ethylene)."""
    cotton = tactics.decision_cards("cotton", 21.6, 20.0)
    ethylene = tactics.decision_cards("ethylene", 21.6, 20.0)

    def inert(out):
        card = _card(out["cards"], "suppression")
        return next(o for o in card["options"] if "Inert" in o["label"])["score"]

    assert inert(cotton) < inert(ethylene)


def test_cool_flame_flags_monitor_only():
    out = tactics.decision_cards("heptane", 17.0, 0.0)
    card = _card(out["cards"], "suppression")
    monitor = next(o for o in card["options"] if "Monitor" in o["label"])
    assert "cool" in monitor["why"].lower() or "FLEX" in monitor["why"]


def test_briefing_cites_nearest_run():
    out = tactics.decision_cards("cotton", 21.6, 20.0)
    top = out["neighbors"][0]
    assert top["accession"] in out["briefing"]
    assert top["runId"] in out["briefing"]


def test_options_carry_countermeasure_actions():
    """Every option must name its countermeasure so a click applies the
    action instead of replaying the same untreated fire."""
    out = tactics.decision_cards("cotton", 21.6, 20.0)
    sup = _card(out["cards"], "suppression")
    assert [o["action"] for o in sup["options"]] == [
        "inert-gas", "water-mist", "monitor",
    ]
    air = _card(out["cards"], "containment")
    assert len({o["action"] for o in air["options"]}) == 3


def test_monitor_never_beats_real_suppression_on_hidden_fuel():
    """Monitor-only is scored on detection adequacy — on a cool-flame
    fuel it must rank strictly below both countermeasures."""
    out = tactics.decision_cards("heptane", 17.0, 0.0)
    sup = _card(out["cards"], "suppression")
    scores = {o["action"]: o["score"] for o in sup["options"]}
    assert scores["monitor"] < min(scores["inert-gas"], scores["water-mist"])


def test_unfitted_material_resolves_chamber_fields():
    """materialId=butane resolves to pmma inside risk_index — the chamber
    block must quote the resolved material + pressure, not echo the
    unrecognized id with a zeroed C++ lookup."""
    from backend.api.main import api_decision_cards

    out = api_decision_cards("butane", 21.0, 0.0)
    assert out["chamber"]["materialId"] == out["material"]["materialId"]
    assert out["chamber"]["materialId"] == "pmma"
    assert out["chamber"]["requestedMaterialId"] == "butane"
    assert out["chamber"]["ignitionPressure"] > 0


def test_deterministic():
    a = tactics.decision_cards("pmma", 21.0, 10.0, "lunar")
    b = tactics.decision_cards("pmma", 21.0, 10.0, "lunar")
    assert a == b
