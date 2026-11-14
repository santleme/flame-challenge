"""Regression tests for the ETL pipelines (pytest).

Run:  pytest data/pipelines/test_pipelines.py
Covers the review-driven cases: outcome classification at the Dext
sentinel boundary, negated cool-flame comments in both parser paths,
NTRS author/year extraction, catalog merges across the JSON key-type
boundary, starter restore, and the calibration-input requirement.
"""

from __future__ import annotations

import csv
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


# ---- cool-flame negation awareness ----

@pytest.mark.parametrize("text", [
    "Manually stopped the flow. No cool flame detected.",
    "No cool flame detected.",
    "A cool flame was not observed.",
    "cool flame not formed during the test",
])
def test_negated_cool_flame_is_negative(text):
    assert norm.cool_flame_observed(text) is False


@pytest.mark.parametrize("text", [
    "cool flame observed after extinction",
    "second-stage cool flame visible",
    "a cool-flame regime followed the hot burn",
    "No ignition occurred; a cool flame followed.",
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


# ---- legacy corpus ingestion (data/psi/processed/*.csv) ----

def test_legacy_outcome_maps_modes():
    assert norm._legacy_outcome({"extinction_mode": "Radiative"}) == \
        ("extinction", "radiative")
    assert norm._legacy_outcome({"extinction_mode": "",
                                 "ignition_flag": "no"}) == \
        ("no-ignition", "none")
    out, et = norm._legacy_outcome({"extinction_mode": "Blow-off"})
    assert (out, et) == ("extinction", "blow-off")


def test_legacy_runs_skip_covered_accessions():
    # PSI-26 (BASS) is in the committed legacy corpus — mark it covered and
    # confirm those rows are excluded while uncovered accessions remain
    rows = norm.parse_legacy_runs({"PSI-26"})
    if not (norm.LEGACY_DIR / "experimental_runs.csv").exists():
        pytest.skip("legacy corpus not present")
    assert all(r["accession"] != "PSI-26" for r in rows)
    assert {r["investigation_id"] for r in rows} <= {
        inv for inv, _ in norm.ACCESSIONS.values()}


def test_legacy_rows_follow_fields_schema():
    rows = norm.parse_legacy_runs(set()) + norm.parse_legacy_flex(set())
    if not rows:
        pytest.skip("legacy corpus not present")
    for r in rows:
        assert set(r) == set(norm.FIELDS)
        assert r["verified"] is True


def test_legacy_flex_emits_burn_rate():
    rows = norm.parse_legacy_flex(set())
    if not rows:
        pytest.skip("flex_test_points.csv not present")
    assert any(r["burn_rate_mm2_s"] for r in rows)
    assert all(r["investigation_id"] == "flex-2" for r in rows)


# ---- effectiveLoc parity contract (calibrate -> fit round-trip) ----

def test_calibrate_emits_effective_loc(monkeypatch, tmp_path):
    import calibrate_constants as calib
    ds = {"investigations": [{
        "id": "demo-flex", "name": "DEMO", "fuels": ["heptane"],
        "category": "droplet", "gravity": "microgravity", "hazards": [],
        "metrics": {"limitingOxygenPct": None, "flameSpreadRateCms": None,
                    "coolFlameObserved": True, "smolderObserved": False},
        "conditions": {"oxygenPct": [12, 25], "flowCms": None,
                       "pressureKpa": None, "explorationRelevant": True},
        "data": {"psiUrl": None},
    }]}
    (tmp_path / "ds.json").write_text(json.dumps(ds))
    (tmp_path / "shared" / "calibrated-data").mkdir(parents=True)
    for f in ("historical_scenarios.json", "tech_spinoffs.json"):
        (tmp_path / "shared" / "calibrated-data" / f).write_text("{}")
    (tmp_path / "fe").mkdir()
    monkeypatch.setattr(calib, "ROOT", tmp_path)
    monkeypatch.setattr(calib, "DATASET", tmp_path / "ds.json")
    monkeypatch.setattr(calib, "OUT", tmp_path / "calibration.json")
    monkeypatch.setattr(calib, "RISK_OUT", tmp_path / "risk_profiles.json")
    monkeypatch.setattr(calib, "FRONTEND_DATA", tmp_path / "fe")
    assert calib.main() == 0
    cal = json.loads((tmp_path / "calibration.json").read_text())
    spec = cal["investigations"]["demo-flex"]
    # no measured LOC -> canonical value is the primary material's (12.0)
    assert spec["loc"] is None
    assert spec["effectiveLoc"] == 12.0


def test_fit_propagates_fitted_loc_to_calibration(monkeypatch, tmp_path):
    cal = {"materials": [{"id": "heptane", "name": "Heptane", "locPct": 12.0,
                          "sootIndex": 0.4, "coolFlameCapable": True,
                          "smoldering": False, "spreadMinCms": 0.2,
                          "spreadMaxCms": 4.0}],
           "investigations": {"demo": {"materialId": "heptane", "loc": None}}}
    cal_path = tmp_path / "calibration.json"
    cal_path.write_text(json.dumps(cal))
    header = ",".join(norm.FIELDS) + "\n"
    def _row(i: int) -> str:
        r = ["run_id", "accession", "investigation_id", "fuel",
             "material_id", "o2_pct", "n2_pct", "co2_pct", "he_pct",
             "pressure_kpa", "temp_k", "flow_cms", "droplet_d0_mm",
             "burn_rate_mm2_s", "burn_time_s", "extinction_d_mm",
             "outcome", "extinction_type", "cool_flame", "fiber_support",
             "comments", "source_file", "source_url", "verified"]
        vals = [f"r{i}", "PSI-69", "flex-2", "heptane", "heptane",
                str(round(14 + i * 0.1, 1)), "", "", "", "", "", "", "",
                "", "", "", "extinction", "oxygen-limit", "False", "",
                "", "f.txt", "u", "True"]
        assert len(vals) == len(r)
        return ",".join(vals)
    body = "".join(_row(i) + "\n" for i in range(12))
    exp = tmp_path / "experiments.csv"
    exp.write_text(header + body)
    monkeypatch.setattr(fit_risk_model, "EXP_CSV", exp)
    monkeypatch.setattr(fit_risk_model, "CALIBRATION", cal_path)
    monkeypatch.setattr(fit_risk_model, "OUT", tmp_path / "risk_model.json")
    monkeypatch.setattr(fit_risk_model, "FRONTEND_OUT", tmp_path / "fe.json")
    monkeypatch.setattr(fit_risk_model, "REPO", tmp_path)
    assert fit_risk_model.main() == 0
    patched = json.loads(cal_path.read_text())
    # median of the three lowest limit-extinctions (~14) becomes canonical
    assert patched["materials"][0]["locPct"] == 14.1
    assert patched["materials"][0]["locSource"] == "psi-data"
    assert patched["investigations"]["demo"]["effectiveLoc"] == 14.1
    rm = json.loads((tmp_path / "risk_model.json").read_text())
    assert rm["materials"]["heptane"]["locMethod"] == "extinction-floor"


LEGACY_RUNS_COLS = [
    "accession", "data_id", "row_idx", "fuel_or_material", "fuel_bottle",
    "o2_pct_min", "o2_pct_max", "o2_mf_min", "o2_mf_max", "n2_mf_raw",
    "co2_mf_raw", "he_mf_raw", "pressure_atm_min", "pressure_atm_max",
    "temperature_k_raw", "airflow_cm_s_min", "airflow_cm_s_max",
    "flow_direction", "d0_mm_min", "d0_mm_max", "dext_mm_min",
    "dext_mm_max", "burn_time_s", "extinction_mode", "ignition_flag",
    "cool_flame_flag", "spread_length_raw", "spread_rate_raw", "comments",
    "notes", "source_table", "figure_id", "extra_json",
]


def _legacy_runs_csv(tmp_path, rows: list[dict]):
    p = tmp_path / "experimental_runs.csv"
    with p.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(LEGACY_RUNS_COLS)
        for d in rows:
            w.writerow([d.get(c, "") for c in LEGACY_RUNS_COLS])
    return p


def test_legacy_explicit_no_cool_flag_beats_comment(monkeypatch, tmp_path):
    (tmp_path / "flex_test_points.csv").touch()  # exists but empty
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-98", "data_id": "SF1", "fuel_or_material": "SIBAL",
         "o2_pct_min": "21", "o2_pct_max": "21", "airflow_cm_s_min": "20",
         "cool_flame_flag": "no", "comments": "cool flame observed"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    rows = norm.parse_legacy_runs(set())
    assert len(rows) == 1
    assert rows[0]["cool_flame"] is False   # structured "no" wins


def test_legacy_qualified_yes_flag_counts(monkeypatch, tmp_path):
    (tmp_path / "flex_test_points.csv").touch()
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-98", "data_id": "SF2", "fuel_or_material": "SIBAL",
         "o2_pct_min": "21", "cool_flame_flag": "yes, PCI-G"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    rows = norm.parse_legacy_runs(set())
    assert rows[0]["cool_flame"] is True    # 'yes, PCI-G' — leading token


def test_legacy_na_flag_is_unrecorded_not_no(monkeypatch, tmp_path):
    (tmp_path / "flex_test_points.csv").touch()
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-98", "data_id": "SF3", "fuel_or_material": "SIBAL",
         "o2_pct_min": "21", "cool_flame_flag": "n/a",
         "comments": "cool flame observed"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    rows = norm.parse_legacy_runs(set())
    assert rows[0]["cool_flame"] is True    # n/a → comments decide


def test_legacy_co2_mode_is_suppressant_not_oxygen_limit():
    out, et = norm._legacy_outcome({"extinction_mode": "CO2 suppression"})
    assert (out, et) == ("extinction", "suppressant")


def test_legacy_cfi_codes_ft_and_se():
    assert norm._legacy_outcome({"extinction_mode": "FT"}) == ("burnout", "none")
    assert norm._legacy_outcome({"extinction_mode": "SE"}) == (
        "extinction", "oxygen-limit")
    # '-' is a placeholder, not a regime — falls through to burn_time
    assert norm._legacy_outcome(
        {"extinction_mode": "-", "burn_time_s": "300"}) == ("burnout", "none")


def test_flex_test_end_drives_outcome():
    base = {"extra_json": json.dumps({"Test end": "Extinction"})}
    assert norm._flex_end_outcome(base) == ("extinction", "radiative")
    assert norm._flex_end_outcome(
        {"extra_json": json.dumps({"Test end": "Disruption"})}
    ) == ("disruption", "none")
    assert norm._flex_end_outcome(
        {"extra_json": json.dumps({"Test end": "Completion"})}
    ) == ("burnout", "none")
    assert norm._flex_end_outcome(
        {"ignition_flag": "no",
         "extra_json": json.dumps({"Test end": "Extinction"})}
    ) == ("no-ignition", "none")


def test_legacy_flex_cir_dedup(monkeypatch, tmp_path):
    """The same FLEX test exists in both legacy tables under different
    ids ('2; 20CAL10' vs FLEX-002/20CAL10) — emit it once, from the
    richer test-points table."""
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-69", "data_id": "2; 20CAL10",
         "fuel_or_material": "Heptane", "o2_pct_min": "15",
         "extra_json": json.dumps({"Test end": "Extinction"})},
        {"accession": "PSI-69", "data_id": "9; 30CAL07",  # runs-only
         "fuel_or_material": "Heptane", "o2_pct_min": "16",
         "extra_json": json.dumps({"Test end": "Completion"})},
    ])
    (tmp_path / "flex_test_points.csv").write_text(
        "accession,test_id,cir_test_number,fuel_or_material,o2_mf,"
        "dext_mm,comments\n"
        "PSI-69,FLEX-002,20CAL10,Heptane,0.15,1.2,radiative extinction\n")
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    runs = norm.parse_legacy_runs(set())
    pts = norm.parse_legacy_flex(set())
    assert len(runs) == 1 and runs[0]["run_id"] == "9; 30CAL07"
    assert len(pts) == 1 and pts[0]["run_id"] == "FLEX-002"
    assert pts[0]["outcome"] == "extinction"   # Test end, not comments


def test_legacy_non_test_rows_skipped(monkeypatch, tmp_path):
    """Figure captions (no specimen, no measurements) and pre-test
    flow-visualization records are metadata, not experiments."""
    (tmp_path / "flex_test_points.csv").touch()
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-142", "data_id": "1", "figure_id": "4",
         "notes": "CFE limit with ozone"},                      # caption
        {"accession": "PSI-98", "data_id": "",
         "fuel_or_material": "Pre-test flow visualization",   # ops record
         "o2_pct_min": "21.5", "airflow_cm_s_min": "20"},
        {"accession": "PSI-98", "data_id": "",
         "fuel_or_material": "SIBAL Fabric",                  # real test
         "o2_pct_min": "21.5", "airflow_cm_s_min": "20",
         "burn_time_s": "420"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    rows = norm.parse_legacy_runs(set())
    assert len(rows) == 1
    assert rows[0]["fuel"] == "SIBAL Fabric"
