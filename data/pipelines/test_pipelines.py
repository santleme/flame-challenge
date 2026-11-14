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


def _flex_points_csv(tmp_path, rows: list[dict]):
    cols = ["accession", "test_id", "cir_test_number", "test_time",
            "fuel_or_material",
            "o2_mf", "n2_mf", "co2_mf", "he_mf", "pressure_atm",
            "temperature_k", "d0_mm", "kavg_mm2_s", "dext_mm", "fiber",
            "comments", "source_file"]
    p = tmp_path / "flex_test_points.csv"
    with p.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for d in rows:
            w.writerow([d.get(c, "") for c in cols])
    return p


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
    _flex_points_csv(tmp_path, [
        {"accession": "PSI-69", "test_id": "FLEX-002",
         "cir_test_number": "20CAL10", "fuel_or_material": "Heptane",
         "o2_mf": "0.15", "dext_mm": "1.2",
         "comments": "radiative extinction"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    runs = norm.parse_legacy_runs(set())
    pts = norm.parse_legacy_flex(set())
    assert len(runs) == 1 and runs[0]["run_id"] == "9; 30CAL07"
    assert len(pts) == 1 and pts[0]["run_id"] == "FLEX-002"
    assert pts[0]["outcome"] == "extinction"   # Test end, not comments


def test_flex_pairs_by_cir_not_sequence(monkeypatch, tmp_path):
    """The tables number tests differently: FLEX-157's summary is
    '156; C03H401' — pairing must join on CIR, not the digit prefix,
    and the dedup set must be the resolved mapping."""
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-69", "data_id": "156; C03H401",
         "fuel_or_material": "Heptane", "burn_time_s": "3.2",
         "extra_json": json.dumps(
             {"Test GMT": "19:12:27", "Test end": "Completion"})},
        {"accession": "PSI-69", "data_id": "157; C05M101",
         "fuel_or_material": "Methanol", "burn_time_s": "7.6",
         "extra_json": json.dumps(
             {"Test GMT": "13:41:00", "Test end": "Extinction"})},
    ])
    _flex_points_csv(tmp_path, [
        {"accession": "PSI-69", "test_id": "FLEX-157",
         "cir_test_number": "C03H401", "test_time": "19:12:27 (GMT)",
         "fuel_or_material": "Heptane", "o2_mf": "0.18"},
        {"accession": "PSI-69", "test_id": "FLEX-158",
         "cir_test_number": "C05M101", "test_time": "13:41:00 (GMT)",
         "fuel_or_material": "Methanol", "o2_mf": "0.16"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    pts = {p["run_id"]: p for p in norm.parse_legacy_flex(set())}
    # FLEX-157 keeps ITS summary (Completion/3.2s), not the methanol run
    assert pts["FLEX-157"]["outcome"] == "burnout"
    assert pts["FLEX-157"]["burn_time_s"] == 3.2
    assert pts["FLEX-158"]["outcome"] == "extinction"
    assert pts["FLEX-158"]["burn_time_s"] == 7.6
    # and both summaries are consumed — neither leaks into runs output
    assert not norm.parse_legacy_runs(set())


def test_flex_shared_cir_corroborated_by_gmt(monkeypatch, tmp_path):
    """Same-CIR collisions resolve by test GMT when sequences disagree —
    FLEX-070/073 share 193F001 and their summaries carry other prefixes."""
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-69", "data_id": "68; 193F001",
         "fuel_or_material": "Heptane", "burn_time_s": "1.6",
         "extra_json": json.dumps(
             {"Test GMT": "10:00:00", "Test end": "Extinction"})},
        {"accession": "PSI-69", "data_id": "74; 193F001",
         "fuel_or_material": "Heptane", "burn_time_s": "1.5",
         "extra_json": json.dumps(
             {"Test GMT": "11:00:00", "Test end": "Extinction"})},
    ])
    _flex_points_csv(tmp_path, [
        {"accession": "PSI-69", "test_id": "FLEX-070",
         "cir_test_number": "193F001", "test_time": "10:00:00 (GMT)",
         "fuel_or_material": "Heptane", "o2_mf": "0.15",
         "comments": "flame extinction"},
        {"accession": "PSI-69", "test_id": "FLEX-073",
         "cir_test_number": "193F001", "test_time": "11:00:00 (GMT)",
         "fuel_or_material": "Heptane", "o2_mf": "0.15",
         "comments": "flame extinction"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    pts = {p["run_id"]: p for p in norm.parse_legacy_flex(set())}
    assert pts["FLEX-070"]["burn_time_s"] == 1.6
    assert pts["FLEX-073"]["burn_time_s"] == 1.5


def test_radiative_wording_not_suppressant(monkeypatch, tmp_path):
    """'radiatively extinguishing' + ambient O2/N2/CO2 composition →
    radiative, not suppressant — gas mixture text is not agent evidence."""
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-69", "data_id": "115; C12M101",
         "fuel_or_material": "Methanol",
         "extra_json": json.dumps(
             {"Test GMT": "19:21:31", "Test end": "Extinction"})},
    ])
    _flex_points_csv(tmp_path, [
        {"accession": "PSI-69", "test_id": "FLEX-121",
         "cir_test_number": "C12M101", "test_time": "19:21:31 (GMT)",
         "fuel_or_material": "Methanol", "o2_mf": "0.12",
         "comments": "droplet burning in a 0.12/0.49/0.40 O2/N2/CO2, "
                     "1.0 atm ambient environment. The flame oscillates "
                     "before radiatively extinguishing."},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    (pt,) = norm.parse_legacy_flex(set())
    assert pt["extinction_type"] == "radiative"


def test_ambient_co2_is_not_suppressant_evidence():
    """A generic extinction + ambient mixture → oxygen-limit; only
    suppression-agent wording earns 'suppressant'."""
    out = norm.classify_outcome(
        "burning in a 0.12/0.49/0.40 O2/N2/CO2 ambient. "
        "diffusive extinction at finite diameter", None)
    assert out[:2] == ("extinction", "oxygen-limit")
    out = norm.classify_outcome(
        "flame extinguished by co2 flood discharge", None)
    assert out[:2] == ("extinction", "suppressant")


def test_radiative_loss_mention_does_not_erase_completion():
    """A completed burn that merely mentions radiative losses is NOT an
    extinction — radiative wordings only type an affirmed extinction."""
    out = norm.classify_outcome(
        "Radiative losses were small; droplet burned to completion.", 0.0)
    assert out == ("burnout", "none", False)
    out = norm.classify_outcome(
        "No radiatively extinguishing flame was observed. "
        "Droplet burned to completion.", 0.0)
    assert out[0] == "burnout"


def test_negated_radiative_subtype_falls_through():
    """An affirmed extinction with a negated radiative mechanism types
    as oxygen-limit — negated regime wording must not relabel it."""
    out = norm.classify_outcome(
        "flame extinguished at quiescent limit; "
        "no radiative extinction observed", None)
    assert out[:2] == ("extinction", "oxygen-limit")


def test_radiative_wording_still_types_affirmed_extinction():
    """The added corpus wordings keep working once extinction is
    established — 'radiatively extinguishing', 'due to radiative loss',
    and a measured Dext alongside a loss remark."""
    out = norm.classify_outcome(
        "the flame oscillates before radiatively extinguishing", None)
    assert out[:2] == ("extinction", "radiative")
    out = norm.classify_outcome(
        "flame extinguishes due to radiative loss", None)
    assert out[:2] == ("extinction", "radiative")
    out = norm.classify_outcome("droplet went out; radiative loss", 1.7)
    assert out[:2] == ("extinction", "radiative")


def test_flex_shared_cir_pairs_by_test_number(monkeypatch, tmp_path):
    """FLEX-070 and FLEX-073 share CIR 193F001 — pairing must use the
    test number, not the CIR, or durations get mixed up."""
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-69", "data_id": "70; 193F001",
         "fuel_or_material": "Heptane", "o2_mf_min": "0.15",
         "burn_time_s": "1.6",
         "extra_json": json.dumps({"Test end": "Extinction"})},
        {"accession": "PSI-69", "data_id": "73; 193F001",
         "fuel_or_material": "Heptane", "o2_mf_min": "0.15",
         "burn_time_s": "1.5",
         "extra_json": json.dumps({"Test end": "Extinction"})},
    ])
    _flex_points_csv(tmp_path, [
        {"accession": "PSI-69", "test_id": "FLEX-070",
         "cir_test_number": "193F001", "fuel_or_material": "Heptane",
         "o2_mf": "0.15", "comments": "flame extinction"},
        {"accession": "PSI-69", "test_id": "FLEX-073",
         "cir_test_number": "193F001", "fuel_or_material": "Heptane",
         "o2_mf": "0.15", "comments": "flame extinction"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    pts = norm.parse_legacy_flex(set())
    assert len(pts) == 2
    by_id = {p["run_id"]: p for p in pts}
    assert by_id["FLEX-070"]["burn_time_s"] == 1.6
    assert by_id["FLEX-073"]["burn_time_s"] == 1.5


def test_flex_duplicate_sheets_emit_once(monkeypatch, tmp_path):
    """FLEX-127/128 are the same experiment recorded twice — same CIR,
    GMT, fuel and measurements, both resolving to '127; C13M301'.
    Collapse corroborated duplicates; sheets with different recorded
    values are distinct runs and must be preserved."""
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-69", "data_id": "127; C13M301",
         "fuel_or_material": "Methanol", "burn_time_s": "11.0",
         "extra_json": json.dumps(
             {"Test GMT": "19:22:49", "Test end": "Extinction"})},
    ])
    sheet = {"accession": "PSI-69", "cir_test_number": "C13M301",
             "test_time": "19:22:49 (GMT)", "fuel_or_material": "Methanol",
             "o2_mf": "0.17", "d0_mm": "3.22", "kavg_mm2_s": "0.38",
             "dext_mm": "2.53", "pressure_atm": "0.71", "fiber": "Yes",
             "comments": "radiative extinction"}
    _flex_points_csv(tmp_path, [
        dict(sheet, test_id="FLEX-127"),
        dict(sheet, test_id="FLEX-128"),
        dict(sheet, test_id="FLEX-129",
             d0_mm="3.30", kavg_mm2_s="0.40"),
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    pts = norm.parse_legacy_flex(set())
    assert [p["run_id"] for p in pts] == ["FLEX-127", "FLEX-129"]


def test_flex_point_placeholders_backfilled(monkeypatch, tmp_path):
    """FLEX-112/120/136 ship blank fuel and o2_mf=0.00 — the summary
    row holds the real values and must backfill them."""
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-69", "data_id": "112; C10M401",
         "fuel_or_material": "Methanol", "o2_mf_min": "0.21",
         "o2_mf_max": "0.21",
         "extra_json": json.dumps({"Test end": "Completion"})},
    ])
    _flex_points_csv(tmp_path, [
        {"accession": "PSI-69", "test_id": "FLEX-112",
         "cir_test_number": "C10M401", "fuel_or_material": "",
         "o2_mf": "0.00", "d0_mm": "3.99", "comments": "fiber test"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    pts = norm.parse_legacy_flex(set())
    assert len(pts) == 1
    assert pts[0]["fuel"] == "Methanol"
    assert pts[0]["o2_pct"] == 21.0
    assert pts[0]["outcome"] == "burnout"      # Test end = Completion


def test_flex_point_comments_drive_extinction_regime(monkeypatch, tmp_path):
    """The summary row's comments are blank — the regime must come from
    the test point's own comment, not default to 'radiative'."""
    _legacy_runs_csv(tmp_path, [
        {"accession": "PSI-69", "data_id": "1; A1",
         "fuel_or_material": "Heptane",
         "extra_json": json.dumps({"Test end": "Extinction"})},
        {"accession": "PSI-69", "data_id": "2; A2",
         "fuel_or_material": "Heptane",
         "extra_json": json.dumps({"Test end": "Extinction"})},
    ])
    _flex_points_csv(tmp_path, [
        {"accession": "PSI-69", "test_id": "FLEX-001", "cir_test_number": "A1",
         "fuel_or_material": "Heptane", "o2_mf": "0.15",
         "comments": "diffusive extinction at finite diameter"},
        {"accession": "PSI-69", "test_id": "FLEX-002", "cir_test_number": "A2",
         "fuel_or_material": "Heptane", "o2_mf": "0.15",
         "comments": "radiative extinction observed"},
    ])
    monkeypatch.setattr(norm, "LEGACY_DIR", tmp_path)
    pts = {p["run_id"]: p for p in norm.parse_legacy_flex(set())}
    assert pts["FLEX-001"]["extinction_type"] == "oxygen-limit"
    assert pts["FLEX-002"]["extinction_type"] == "radiative"


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
