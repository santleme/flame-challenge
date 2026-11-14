"""Tests for backend.services.neighbors — the KNN physical lookup."""
from __future__ import annotations

from backend.services import neighbors


def test_nearest_returns_k_sorted_by_similarity():
    out = neighbors.nearest("cotton", 21.0, 10.0, k=3)
    assert len(out) == 3
    sims = [n["similarity"] for n in out]
    assert sims == sorted(sims, reverse=True)
    assert all(0 < s <= 100 for s in sims)


def test_cotton_at_saffire_point_surfaces_sibal_runs():
    """The SAFFIRE SIBAL burns (PSI-98/99/100) must be the closest real
    tests to a cotton fire at ~21.6% O₂ / 20 cm/s forced flow."""
    out = neighbors.nearest("cotton", 21.6, 20.0, k=3)
    assert out[0]["similarity"] >= 90
    assert out[0]["accession"] in {"PSI-98", "PSI-99", "PSI-100"}
    assert "SIBAL" in out[0]["fuel"].upper() or "cotton" in out[0]["fuel"].lower()


def test_heptane_finds_flex_droplet_runs():
    out = neighbors.nearest("heptane", 17.0, 0.0, k=3)
    assert any(n["accession"] == "PSI-69" for n in out)
    assert any("heptane" in n["fuel"].lower() for n in out)


def test_same_material_beats_closer_o2_in_other_class():
    """A PMMA run with unrecorded O₂ is closer to a PMMA question than a
    gas run at the exact point — material class dominates."""
    out = neighbors.nearest("pmma", 21.0, 0.0, k=3)
    assert any(n["materialKey"] and "pmma" in n["materialKey"] for n in out)


def test_unknown_material_still_returns_results():
    out = neighbors.nearest("unobtanium", 21.0, 0.0, k=3)
    assert len(out) == 3
    assert all(n["similarity"] > 0 for n in out)


def test_deterministic():
    a = neighbors.nearest("cotton", 21.6, 20.0)
    b = neighbors.nearest("cotton", 21.6, 20.0)
    assert a == b


def test_ethane_does_not_alias_methane():
    """Substring matching must not treat 'ethane' inside 'methane' (or
    'ethanol' inside 'methanol') as the same substance — aliases match on
    chemical-name token boundaries."""
    out = neighbors.nearest("ethane", 32.5, 0.0, k=3)
    assert out
    # top hit must be an actual ethane run, not a methane impostor
    top_fuel = out[0]["fuel"].lower()
    assert "methane" not in top_fuel
    assert out[0]["materialKey"] in {"ethane", None} or "ethane" in top_fuel


def test_ethanol_does_not_alias_methanol():
    # methanol is a same-CLASS neighbor for ethanol, never an alias —
    # the regression was substring matching ('ethanol' inside 'methanol')
    assert neighbors._affinity("ethanol", "methanol", "Methanol") \
        == neighbors.AFFINITY_CLASS
    # while real ethanol wording in the fuel text still earns the alias
    assert neighbors._affinity("ethanol", "methanol", "Ethanol (pure)") \
        == neighbors.AFFINITY_ALIAS


def test_hyphenated_aliases_match_fuel_text():
    """Aliases like 'iso-octane', 'jp-8', 'decan-1-ol' must match fuel
    text written with hyphen, space, or squash — the tokenizer splits
    them, so matching happens on normalized phrases."""
    assert neighbors._row_material_key({"fuel": "iso-octane droplet"}) == "iso-octane"
    assert neighbors._row_material_key({"fuel": "Iso Octane"}) == "iso-octane"
    assert neighbors._row_material_key({"fuel": "JP-8 pool fire"}) == "jp8"
    assert neighbors._row_material_key({"fuel": "decan-1-ol wick"}) == "decanol"
    assert neighbors._row_material_key({"fuel": "n-heptane"}) == "heptane"


def test_k_is_bounded():
    assert len(neighbors.nearest("pmma", 21.0, k=0)) == 1
    assert len(neighbors.nearest("pmma", 21.0, k=99)) <= 10


def test_payload_shape():
    n = neighbors.nearest("cotton", 21.6, 20.0, k=1)[0]
    for key in ("runId", "accession", "investigationId", "fuel",
                "o2Pct", "flowCms", "outcome", "similarity", "sourceUrl"):
        assert key in n
