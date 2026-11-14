"""Regression tests for the ETL pipelines (pytest).

Run:  pytest data/pipelines/test_pipelines.py
Covers the review-driven cases: outcome classification at the Dext
sentinel boundary, negated cool-flame comments in both parser paths,
NTRS author/year extraction, catalog merges across the JSON key-type
boundary, starter restore, and the calibration-input requirement.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_dataset  # noqa: E402
import fit_risk_model  # noqa: E402
import normalize_experiments as norm  # noqa: E402
import ntrs_search  # noqa: E402


# ---- classify_outcome: Dext sentinel semantics ----

def test_dext_zero_means_burnout_not_extinction():
    # FLEX-051-style sheet: "Dext (mm) = 0.00" + completion comment
    out, _, _ = norm.classify_outcome(
        "The droplet burns to completion.", 0.0)
    assert out == "burnout"


def test_dext_positive_is_extinction():
    out, _, _ = norm.classify_outcome("", 1.24)
    assert out == "extinction"


def test_dext_missing_is_unknown():
    out, _, _ = norm.classify_outcome("", None)
    assert out == "unknown"


def test_dext_zero_alone_still_burnout():
    # data dictionary: 0 = no extinction observed -> droplet consumed
    out, _, _ = norm.classify_outcome("", 0.0)
    assert out == "burnout"


def test_explicit_extinction_text_wins():
    out, etype, _ = norm.classify_outcome("flame went to extinction", 0.0)
    assert out == "extinction"
    assert etype == "oxygen-limit"


def test_negated_extinction_words_do_not_count():
    # "no extinction observed" must not produce outcome=extinction
    out, _, _ = norm.classify_outcome(
        "burned to completion; no extinction observed", 0.0)
    assert out == "burnout"


def test_extinguisher_equipment_is_not_extinction():
    out, _, _ = norm.classify_outcome(
        "a fire extinguisher was staged nearby for safety", None)
    assert out == "unknown"


def test_completion_comment_beats_dext_sentinel():
    out, _, _ = norm.classify_outcome("droplet burned to completion", 0.0)
    assert out == "burnout"


# ---- cool-flame negation awareness ----

@pytest.mark.parametrize("text", [
    "Manually stopped the flow. No cool flame detected.",
    "No cool flame detected.",
    "A cool flame was not observed.",
    "cool flame not formed during the test",
    "no evidence of a cool flame was found",
    "without a cool flame the droplet went out",
    "cool flame was never observed",
    "droplet never had a cool flame",
])
def test_negated_cool_flame_is_negative(text):
    assert norm.cool_flame_observed(text) is False


@pytest.mark.parametrize("text", [
    "cool flame observed after extinction",
    "second-stage cool flame visible",
    "a cool-flame regime followed the hot burn",
    "No ignition occurred; a cool flame followed.",
    "no ignition and a cool flame",
    "cool flame no more than 2 s visible",
])
def test_affirmative_cool_flame_is_positive(text):
    assert norm.cool_flame_observed(text) is True


def test_classify_outcome_uses_negation_aware_cool():
    *_, cool = norm.classify_outcome("No cool flame detected.", None)
    assert cool is False


# ---- CSV path: negated comment + explicit structured negative ----

def _write_psi159_csv(path: Path, rows: list[str]) -> Path:
    path.write_text(
        "Test,O2,Fuel,Hot ignition,SE or FT,Cool flame,Flow (cm/s),Comments\n"
        + "\n".join(rows) + "\n",
        encoding="utf-8")
    return path


def test_csv_negated_comment_not_cool(tmp_path):
    p = _write_psi159_csv(tmp_path / "psi159.csv", [
        "21102A1,0.21,Heptane,Y,SE,,10,"
        "Manually stopped the flow. No cool flame detected.",
    ])
    rows = norm.sniff_csv_rows(p, "PSI-159", "acme")
    assert len(rows) == 1
    assert rows[0]["cool_flame"] is False


def test_csv_explicit_no_beats_positive_comment(tmp_path):
    # structured "N" is a recorded non-observation — comments can't flip it
    p = _write_psi159_csv(tmp_path / "psi159.csv", [
        "21102A2,0.19,Heptane,Y,FT,N,10,cool flame appeared briefly",
    ])
    rows = norm.sniff_csv_rows(p, "PSI-159", "acme")
    assert rows[0]["cool_flame"] is False


def test_csv_positive_cool_flame(tmp_path):
    p = _write_psi159_csv(tmp_path / "psi159.csv", [
        "21102A3,0.19,Heptane,Y,SE,Y,10,cool flame observed",
    ])
    rows = norm.sniff_csv_rows(p, "PSI-159", "acme")
    assert rows[0]["cool_flame"] is True


# ---- NTRS slim(): real response shape ----

NTRS_FIXTURE = {
    "id": 20150023456,
    "title": "Detailed Results from the Flame Extinguishment Experiment "
             "(FLEX) March 2009 to December 2011",
    "abstract": "...",
    "distributionDate": "2019-06-01",
    "submittedDate": "2015-11-01",
    "created": "2019-06-01",
    "publications": [{"publicationDate": "2015-11"}],
    "authorAffiliations": [
        {"meta": {"author": {"name": "Dietrich, Daniel L."}}},
        {"meta": {"author": {"name": "Struk, Peter M."}}},
        {"meta": {"author": {}}},          # absent name -> omitted
    ],
    "center": {"name": "Glenn Research Center"},
    "downloads": [],
}


def test_slim_prefers_publication_year():
    rec = ntrs_search.slim(NTRS_FIXTURE, "flex-2")
    assert rec["year"] == 2015  # not the 2019 redistribution date


def test_slim_falls_back_when_no_publication_date():
    r = dict(NTRS_FIXTURE)
    del r["publications"]
    rec = ntrs_search.slim(r, "flex-2")
    assert rec["year"] == 2015  # submittedDate, not distributionDate


def test_slim_extracts_meta_author_names():
    rec = ntrs_search.slim(NTRS_FIXTURE, "flex-2")
    assert rec["authors"] == ["Dietrich, Daniel L.", "Struk, Peter M."]


# ---- NTRS merge(): JSON key-type boundary ----

def test_merge_preserves_investigation_links_across_reloads(tmp_path):
    cat = tmp_path / "ntrs_citations.json"
    ntrs_search.merge(cat, {"id": 20150023456, "title": "FLEX",
                            "investigationIds": ["flex-2"]})
    ntrs_search.merge(cat, {"id": 20150023456, "title": "FLEX",
                            "investigationIds": ["acme"]})
    reloaded = json.loads(cat.read_text())
    assert len(reloaded) == 1
    assert set(reloaded["20150023456"]["investigationIds"]) == {"acme", "flex-2"}


# ---- build_dataset --sample restore path ----

def test_restore_starter_outside_data_root(monkeypatch, tmp_path, capsys):
    # dataset lives under <repo>/frontend — outside data/ — exactly the
    # post-restructure layout that made relative_to(ROOT) raise ValueError
    starter = tmp_path / "data" / "starter.json"
    starter.parent.mkdir(parents=True)
    starter.write_text('{"investigations": []}', encoding="utf-8")
    dataset = tmp_path / "frontend" / "src" / "data" / "investigations.json"
    dataset.parent.mkdir(parents=True)
    dataset.write_text('{"investigations": [{"id": "x"}]}', encoding="utf-8")
    monkeypatch.setattr(build_dataset, "DATASET_PATH", dataset)
    monkeypatch.setattr(build_dataset, "STARTER_PATH", starter)
    monkeypatch.setattr(build_dataset, "REPO", tmp_path)
    build_dataset.restore_starter()   # must not raise ValueError
    assert json.loads(dataset.read_text()) == {"investigations": []}
    assert "starter dataset restored" in capsys.readouterr().out


def test_sample_command_exit_status(monkeypatch, tmp_path):
    starter = tmp_path / "data" / "starter.json"
    starter.parent.mkdir(parents=True)
    starter.write_text('{"investigations": []}', encoding="utf-8")
    dataset = tmp_path / "frontend" / "src" / "data" / "investigations.json"
    dataset.parent.mkdir(parents=True)
    dataset.write_text('{"investigations": [{"id": "x"}]}', encoding="utf-8")
    monkeypatch.setattr(build_dataset, "DATASET_PATH", dataset)
    monkeypatch.setattr(build_dataset, "STARTER_PATH", starter)
    monkeypatch.setattr(build_dataset, "REPO", tmp_path)
    monkeypatch.setattr(sys, "argv", ["build_dataset.py", "--sample"])
    assert build_dataset.main() == 0


# ---- fit_risk_model requires calibration ----

def test_fit_risk_fails_without_calibration(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(fit_risk_model, "CALIBRATION",
                        tmp_path / "missing.json")
    monkeypatch.setattr(fit_risk_model, "OUT", tmp_path / "risk_model.json")
    monkeypatch.setattr(fit_risk_model, "FRONTEND_OUT",
                        tmp_path / "fe_risk.json")
    assert fit_risk_model.main() == 1
    assert not (tmp_path / "risk_model.json").exists()
    assert "calibration" in capsys.readouterr().err.lower()
