"""Normalize downloaded PSI test data into a unified experiments table.

Scans data/raw/files/<PSI-XX>/ for per-test parameter files and parses them
into one canonical schema — the "clean CSV" layer of the pipeline:

    run_id            test identifier (FLEX-007, C024M03A, ...)
    accession         PSI accession (PSI-69, ...)
    investigation_id  app investigation (flex-2, acme, bass-ii, ...)
    fuel              fuel/material as recorded
    material_id       engine material id (fuel normalized)
    o2_pct            O2 mole fraction * 100
    n2_pct            N2 mole fraction * 100
    co2_pct           CO2 mole fraction * 100  (suppressant)
    he_pct            He mole fraction * 100   (suppressant)
    pressure_kpa      ambient pressure
    temp_k            ambient temperature
    flow_cms          forced flow speed (None = quiescent/drift only)
    droplet_d0_mm     initial droplet diameter (droplet rigs)
    burn_rate_mm2_s   measured burning-rate constant kavg
    burn_time_s       recorded burn duration (CFI tables)
    extinction_d_mm   droplet diameter at extinction
    outcome           burnout | extinction | no-ignition | disruption | unknown
    extinction_type   radiative | oxygen-limit | blow-off | suppressant | none
    cool_flame        cool-flame regime observed/inferred
    fiber_support     droplet on support fiber
    comments          cleaned comments text (truncated)
    source_file       raw file the row was parsed from
    source_url        PSI repo link for the study
    verified          True — parsed from a real PSI data file

Outputs:
    data/processed/experiments.csv
    data/processed/experiments.json

Usage:
    python data/pipelines/normalize_experiments.py
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # data/
FILES_DIR = ROOT / "raw" / "files"
OUT_DIR = ROOT / "processed"

# accession -> (investigation_id, rig family)
ACCESSIONS = {
    "PSI-69": ("flex-2", "droplet"),
    "PSI-68": ("flex-2", "droplet"),
    "PSI-39": ("flex-2", "droplet"),
    "PSI-142": ("flex-2", "droplet"),
    "PSI-117": ("flex-2", "droplet"),
    "PSI-10": ("acme", "coflow"),
    "PSI-20": ("acme", "coflow"),
    "PSI-21": ("acme", "coflow"),
    "PSI-22": ("acme", "coflow"),
    "PSI-23": ("acme", "coflow"),
    "PSI-106": ("acme", "coflow"),
    "PSI-107": ("acme", "coflow"),
    "PSI-159": ("acme", "droplet"),
    "PSI-26": ("bass-ii", "solid"),
    "PSI-25": ("bass-ii", "solid"),
    "PSI-98": ("saffire", "solid"),
    "PSI-99": ("saffire", "solid"),
    "PSI-100": ("saffire", "solid"),
    "PSI-101": ("same", "aerosol"),
    "PSI-102": ("same", "aerosol"),
    "PSI-115": ("same", "aerosol"),
    "PSI-47": ("same", "aerosol"),
    "PSI-60": ("acme", "coflow"),
    "PSI-62": ("confined-combustion", "solid"),
    "PSI-179": ("same", "aerosol"),
}

# fuel string -> engine material id (superset of calibrate FUEL_TO_MATERIAL)
FUEL_ID = {
    "heptane": "heptane", "n-heptane": "heptane", "heptan": "heptane",
    "methanol": "methanol", "meoh": "methanol",
    "iso-octane": "iso-octane", "isooctane": "iso-octane",
    "iso octane": "iso-octane", "decane": "decanol", "decanol": "decanol",
    "n-decane": "decanol", "nonane": "decanol",
    "ethanol": "methanol", "butanol": "decanol",
    "ethylene": "ethylene", "c2h4": "ethylene",
    "methane": "methane", "ch4": "methane",
    "propane": "propane", "c3h8": "propane",
    "ethane": "ethane", "c2h6": "ethane",
    "butane": "butane", "c4h10": "butane",
    "jp-8": "jp8", "jp8": "jp8", "jet": "jp8",
    "pmma": "pmma", "acrylic": "pmma",
    "cotton": "cotton", "sibal": "cotton",
    "nomex": "nomex", "polycarbonate": "polycarbonate",
    "teflon": "teflon", "kapton": "kapton",
    "pyrell": "pyrell", "silicone": "silicone", "cellulose": "cellulose",
    "paper": "thin-sheet", "cardboard": "thin-sheet",
}

FIELDS = [
    "run_id", "accession", "investigation_id", "fuel", "material_id",
    "o2_pct", "n2_pct", "co2_pct", "he_pct", "pressure_kpa", "temp_k",
    "flow_cms", "droplet_d0_mm", "burn_rate_mm2_s", "burn_time_s",
    "extinction_d_mm", "outcome", "extinction_type", "cool_flame",
    "fiber_support", "comments", "source_file", "source_url", "verified",
]

NUM_RE = r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?"


def _f(pat: str, text: str, cast=float) -> float | str | None:
    m = re.search(pat, text, re.IGNORECASE)
    if not m:
        return None
    try:
        return cast(m.group(1))
    except (ValueError, IndexError):
        return None


def fuel_id(name: str | None) -> str | None:
    if not name:
        return None
    n = name.strip().lower()
    # reject captures that are really field labels / units, not fuel names
    if "=" in n or len(n) < 3 or re.match(r"^(d0|mm|kavg|test|fuel)", n):
        return None
    for key, mid in FUEL_ID.items():
        if key in n:
            return mid
    return re.sub(r"[^a-z0-9]+", "-", n).strip("-") or None


def _affirmative_mention(text: str, pattern: str) -> bool:
    """True when `pattern` is mentioned affirmatively.

    Explicit negative observations ("No cool flame detected.", "no evidence
    of a cool flame", "cool flame was not observed") do NOT count — a
    recorded non-observation is real evidence, not a positive detection.
    Negation scopes only within the current clause and cannot jump a
    conjunction ("no ignition and a cool flame" is affirmative).
    """
    for m in re.finditer(pattern, text, re.IGNORECASE):
        # scan back to the nearest clause boundary — "No ignition occurred;
        # a cool flame followed" must not carry the "No" across ";"
        seg = re.split(r"[.!?;:]", text[max(0, m.start() - 60):m.start()])[-1]
        # a negation word ending the clause up to 4 words back counts, but
        # conjunctions sever it ("no ignition and a cool flame" is positive)
        if re.search(r"\b(?:no|not|never|without|absent|none)\b"
                     r"(?:\s+(?!and|but|or)\w+){0,4}\s*$", seg, re.IGNORECASE):
            continue                                   # negated mention
        head = " ".join(text[m.end():m.end() + 60].lower().split()[:4])
        if re.match(r"[\s,;:()\-]*(?:was|were|is|has been|could be|"
                    r"seemed|appeared|remained)?\s*(?:not|never)\b", head):
            continue             # "cool flame was not ..." / ", not ..."
        return True
    return False


# extinction language excluding the nouns for suppression equipment —
# "extinguisher"/"extinguishant" are not extinction observations
_EXTINCTION_WORDS = (
    r"\b(?:extinct|extinction|extinguished|extinguishes|extinguishing|"
    r"extinguishment)\b")


def cool_flame_observed(text: str) -> bool:
    """Affirmative cool-flame evidence in free text."""
    return _affirmative_mention(text, r"cool[ -]?flames?")


def classify_outcome(comments: str, dext: float | str | None) -> tuple[str, str, bool]:
    """(outcome, extinction_type, cool_flame) from free-text comments."""
    c = comments.lower()
    cool = cool_flame_observed(c)
    if re.search(r"did not ignite|failed to ignite|no ignition|would not ignite|"
                 r"not ignite|non-?ignition", c):
        return "no-ignition", "none", cool
    if re.search(r"radiative extinction|radiative extinction", c):
        return "extinction", "radiative", cool
    if re.search(r"blow.?off|blows? out", c):
        return "extinction", "blow-off", cool
    # affirmative extinction language only — "no extinction observed",
    # "fire extinguisher present" and negated mentions must not count;
    # a positive measured Dext is direct evidence on its own
    if _affirmative_mention(c, _EXTINCTION_WORDS) or \
            (isinstance(dext, float) and dext > 0):
        if cool:
            return "extinction", "cool-flame", True
        return "extinction", "oxygen-limit" if "oxygen" in c else "suppressant" \
            if ("co2" in c or "suppress" in c) else "oxygen-limit", cool
    if "disruption" in c or "burns? to disruption" in c:
        return "disruption", "none", cool
    if re.search(r"burn(ed|s|t)? (to completion|completely|out)|complete burn", c):
        return "burnout", "none", cool
    # Dext=0.00 is the FLEX sentinel for "no extinction observed" (data
    # dictionary), NOT an extinction — completed burns record zero
    if isinstance(dext, float) and dext == 0:
        return "burnout", "none", cool
    return "unknown", "none", cool


def parse_testsheet(text: str, fname: str, acc: str, inv: str) -> dict | None:
    """Parse FLEX/CFI-style CIR per-test parameter sheets."""
    if "TEST CONDITIONS" not in text and "AMBIENT ENVIRONMENT" not in text:
        return None
    run = _f(r"^\s*([A-Z]+[-_ ]?\d+[A-Z]?)\s*$", text.strip().splitlines()[0], str)
    if not run:
        m = re.match(r"([A-Za-z]+[-_]?\d+[A-Za-z]?)", fname)
        run = m.group(1).upper() if m else fname
    fuel = _f(r"Fuel:[^\S\n]*([^\n\t]+)", text, str)
    dext_raw = _f(r"Dext\s*\(mm\)\s*=\s*\t?\s*([^\n\t]+)", text, str)
    try:
        dext = float(str(dext_raw).strip())
    except (TypeError, ValueError):
        dext = None
    if dext is not None and math.isnan(dext):
        dext = None
    pressure_atm = _f(r"Pressure\s*\(atm\)\s*=\s*\t?\s*(" + NUM_RE + ")", text)
    comments = ""
    m = re.search(r"COMMENTS?:?\s*\n(.*)", text, re.DOTALL | re.IGNORECASE)
    if m:
        comments = re.sub(r"\s+", " ", m.group(1)).strip()[:600]
    outcome, etype, cool = classify_outcome(comments + " " + str(dext_raw or ""), dext)
    kavg = _f(r"k\s*avg\s*\(mm2/s\)\s*=\s*\t?\s*(" + NUM_RE + ")", text) \
        or _f(r"kavg\s*=\s*\t?\s*(" + NUM_RE + ")", text)
    row = {
        "run_id": str(run).strip(),
        "accession": acc,
        "investigation_id": inv,
        "fuel": str(fuel).strip() if fuel else None,
        "material_id": fuel_id(str(fuel) if fuel else None),
        "o2_pct": _pct(_f(r"O2 Mole Fraction\s*=\s*\t?\s*(" + NUM_RE + ")", text)),
        "n2_pct": _pct(_f(r"N2 Mole Fraction\s*=\s*\t?\s*(" + NUM_RE + ")", text)),
        "co2_pct": _pct(_f(r"CO2 Mole Fraction\s*=\s*\t?\s*(" + NUM_RE + ")", text)),
        "he_pct": _pct(_f(r"He Mole Fraction\s*=\s*\t?\s*(" + NUM_RE + ")", text)),
        "pressure_kpa": round(pressure_atm * 101.325, 1) if pressure_atm else None,
        "temp_k": _f(r"Temperature\s*\(K\)\s*=\s*\t?\s*(" + NUM_RE + ")", text),
        "flow_cms": _f(r"(?:flow|velocity|air ?speed)\D{0,12}(" + NUM_RE + r")\s*cm", text),
        "droplet_d0_mm": _f(r"D0\s*\(mm\)\s*=\s*\t?\s*(" + NUM_RE + ")", text),
        "burn_rate_mm2_s": kavg,
        "burn_time_s": None,
        "extinction_d_mm": dext,
        "outcome": outcome,
        "extinction_type": etype,
        "cool_flame": cool,
        "fiber_support": str(_f(r"Fiber:[^\S\n]*([^\n\t]+)", text, str) or "").strip() or None,
        "comments": comments,
        "source_file": fname,
        "source_url": f"https://psi.nasa.gov/physci/repo/data/investigation/{acc}",
        "verified": True,
    }
    return row


def _pct(v: float | None) -> float | None:
    """mole fraction -> percent; tolerate inputs already in percent."""
    if v is None:
        return None
    return round(v * 100, 2) if v <= 1.0 else round(v, 2)


def parse_generic_kv(text: str, fname: str, acc: str, inv: str) -> dict | None:
    """Fallback parser: any file containing O2%/fuel-ish key-value pairs."""
    o2 = _f(r"O2[^=\n]{0,20}=\s*\t?\s*(" + NUM_RE + ")", text) \
        or _f(r"oxygen[^=\n]{0,20}[:\s]\s*(" + NUM_RE + r")\s*%?", text)
    fuel = _f(r"Fuel:[^\S\n]*([^\n\t]+)", text, str)
    if o2 is None and fuel is None:
        return None
    m = re.match(r"([A-Za-z]+[-_]?\d+[A-Za-z]?)", fname)
    return {
        "run_id": (m.group(1).upper() if m else fname),
        "accession": acc, "investigation_id": inv,
        "fuel": str(fuel).strip() if fuel else None,
        "material_id": fuel_id(str(fuel) if fuel else None),
        "o2_pct": _pct(o2), "n2_pct": None, "co2_pct": None, "he_pct": None,
        "pressure_kpa": None, "temp_k": None,
        "flow_cms": _f(r"(?:flow|velocity|air ?speed)\D{0,12}(" + NUM_RE + r")\s*cm", text),
        "droplet_d0_mm": None, "burn_rate_mm2_s": None, "burn_time_s": None,
        "extinction_d_mm": None,
        "outcome": "unknown", "extinction_type": "none", "cool_flame": False,
        "fiber_support": None, "comments": "",
        "source_file": fname,
        "source_url": f"https://psi.nasa.gov/physci/repo/data/investigation/{acc}",
        "verified": True,
    }


def sniff_csv_rows(path: Path, acc: str, inv: str) -> list[dict]:
    """Ingest small CSV/TSV files whose header exposes combustion params."""
    try:
        raw = path.read_bytes()[:200_000]
        head = raw[:4096].decode("utf-8", "replace")
    except OSError:
        return []
    first = head.splitlines()[0].lower() if head.splitlines() else ""
    interesting = ("o2" in first or "oxygen" in first) and (
        "fuel" in first or "flow" in first or "veloc" in first or "burn" in first)
    if not interesting:
        return []
    delim = "\t" if "\t" in first else ","
    try:
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8", "replace")),
                                   delimiter=delim))
    except csv.Error:
        return []
    if not rows or len(rows) > 5000:
        return []

    lower_heads = [k.strip().lower() for k in rows[0].keys()]

    def col(r: dict, *names: str) -> float | str | None:
        lower = {k.strip().lower(): v for k, v in r.items()}
        for n in names:
            for k, v in lower.items():
                if n in k and v not in (None, ""):
                    try:
                        return float(v)
                    except ValueError:
                        return v
        return None

    def col_key(*names: str) -> str | None:
        """First header containing any of the name fragments."""
        for n in names:
            for k in lower_heads:
                if n in k:
                    return k
        return None

    # unit-aware columns: pressure reported in atm/bar -> kPa
    p_key = col_key("pressure", "pmean", "pinit", "atm", "(bar)")
    t_key = col_key("ambient", "temp", "t_k", "t(k)")
    test_key = col_key("test", "run", "point")
    hot_key = col_key("hot ignit", "ignition")
    se_key = col_key("self-ext", "self ext", "or flow term")
    cool_key = col_key("cool flame")
    btime_key = col_key("burn time", "burn_time", "burntime")
    comm_key = col_key("comment")
    # d²-law rate only from explicit k/mm2 columns — "burnrate (mg/s)"
    # style headers are fuel-consumption rates, not mm²/s
    krate_key = col_key("mm2", "kavg", "k avg")

    def cell(r: dict, key: str | None) -> str:
        if not key:
            return ""
        lower = {k.strip().lower(): v for k, v in r.items()}
        return str(lower.get(key) or "").strip()

    def num(r: dict, *names: str) -> float | None:
        v = col(r, *names)
        return v if isinstance(v, float) else None

    out = []
    last_fuel: str | None = None
    for i, r in enumerate(rows):
        if all(v in (None, "", " ") for v in r.values()):
            continue                                    # padding rows
        fuel = col(r, "fuel", "material")
        fuel_s = str(fuel) if not isinstance(fuel, float) and fuel else None
        if fuel_s:
            last_fuel = fuel_s                        # merged-cell style
        else:
            fuel_s = last_fuel
        o2 = col(r, "o2", "oxygen")
        o2f = float(o2) if isinstance(o2, float) else \
            (float(o2) if isinstance(o2, str) and re.fullmatch(NUM_RE, o2.strip()) else None)
        p = num(r, "pressure", "pmean", "pinit", "atm", "(bar)")
        pkpa = None
        if isinstance(p, float):
            pkpa = round(p * (101.325 if "atm" in (p_key or "")
                            else 100.0 if "bar" in (p_key or "") else 1.0), 1)
        t = num(r, "ambient", "temp", "t_k", "t(k)")
        run = cell(r, test_key)
        if run.upper() in ("RAMPED", ""):
            run = ""
        comments = cell(r, comm_key)[:600]
        hot = cell(r, hot_key).lower()
        se = cell(r, se_key).upper()
        cool_v = cell(r, cool_key).lower()
        # an explicit structured "no" wins over comment text; with no
        # structured value, negation-aware comment parsing decides
        explicit_no_cool = bool(cool_key) and cool_v.startswith("n")
        cool = cool_v.startswith("y") or (
            not explicit_no_cool and cool_flame_observed(comments))
        # outcome: CFI semantics — Hot ignition N + comments "failed/no
        # ignition"; SE = self-extinguished; FT = flow ended while burning
        low_c = comments.lower()
        if hot.startswith("n") or re.search(r"fail(ed)? to ignite|no ignition", low_c):
            outcome, etype = "no-ignition", "none"
        elif se == "SE":
            outcome, etype = "extinction", "oxygen-limit"
        elif se == "FT":
            outcome, etype = "burnout", "none"
        else:
            outcome, etype, cool_c = classify_outcome(low_c, None)
            cool = cool or (cool_c and not explicit_no_cool)
        out.append({
            "run_id": run or f"{path.stem[:40]}#{i}",
            "accession": acc, "investigation_id": inv,
            "fuel": fuel_s,
            "material_id": fuel_id(fuel_s),
            "o2_pct": _pct(o2f), "n2_pct": None, "co2_pct": None, "he_pct": None,
            "pressure_kpa": pkpa, "temp_k": t,
            "flow_cms": num(r, "flow cm", "veloc", "speed"),
            "droplet_d0_mm": num(r, "d0", "diameter", "droplet"),
            "burn_rate_mm2_s": num(r, "mm2", "kavg", "k avg") if krate_key else None,
            "burn_time_s": num(r, "burn time", "burn_time") if btime_key else None,
            "extinction_d_mm": num(r, "dext", "extinction"),
            "outcome": outcome, "extinction_type": etype, "cool_flame": cool,
            "fiber_support": None, "comments": comments,
            "source_file": path.name,
            "source_url": f"https://psi.nasa.gov/physci/repo/data/investigation/{acc}",
            "verified": True,
        })
    return out


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    stats: dict[str, int] = {}

    for acc, (inv, _family) in ACCESSIONS.items():
        acc_dir = FILES_DIR / acc
        if not acc_dir.exists():
            continue
        n0 = len(rows)
        for path in sorted(acc_dir.iterdir()):
            if path.name.startswith("_") or not path.is_file():
                continue
            ext = path.suffix.lower()
            try:
                if ext in (".txt", ".meta", ".metadata", ".log", ".asc", ".md"):
                    text = path.read_text(encoding="utf-8", errors="replace")
                    row = parse_testsheet(text, path.name, acc, inv) \
                        or parse_generic_kv(text, path.name, acc, inv)
                    if row:
                        rows.append(row)
                elif ext in (".csv", ".tsv"):
                    rows.extend(sniff_csv_rows(path, acc, inv))
            except Exception as exc:  # noqa: BLE001 - one bad file must not abort
                print(f"[WARN] {path.name}: {exc}", file=sys.stderr)
        stats[acc] = len(rows) - n0
        if stats[acc]:
            print(f"[OK] {acc} ({inv}): +{stats[acc]} rows")

    # de-dupe identical runs (same accession+run_id+fuel) keeping the richest
    best: dict[tuple, dict] = {}
    for r in rows:
        key = (r["accession"], r["run_id"], r.get("fuel"))
        score = sum(v is not None for v in r.values())
        if key not in best or score > sum(v is not None for v in best[key].values()):
            best[key] = r
    rows = sorted(best.values(), key=lambda r: (r["accession"], r["run_id"]))

    csv_path = OUT_DIR / "experiments.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    json_path = OUT_DIR / "experiments.json"
    json_path.write_text(
        json.dumps({"generated": "normalize_experiments.py",
                    "schema": FIELDS, "count": len(rows),
                    "experiments": rows}, ensure_ascii=False),
        encoding="utf-8")

    write_structured(rows)

    fuels = {r["fuel"] for r in rows if r["fuel"]}
    print(f"\n[DONE] {len(rows)} normalized experiment rows "
          f"({len(fuels)} fuels) -> {csv_path.relative_to(ROOT)}")
    for acc, n in stats.items():
        if n:
            print(f"       {acc}: {n}")
    return 0


def write_structured(rows: list[dict]) -> None:
    """Per-investigation structured records for build_dataset.py.

    Emitted only for investigations with parsed PSI runs — the dataset
    merge marks these verified and upgrades data.availability to 'full'.
    """
    by_inv: dict[str, list[dict]] = {}
    for r in rows:
        by_inv.setdefault(r["investigation_id"], []).append(r)

    records = []
    for inv, rs in sorted(by_inv.items()):
        o2s = [float(r["o2_pct"]) for r in rs if r.get("o2_pct")]
        exts = [float(r["o2_pct"]) for r in rs
                if r.get("o2_pct") and r.get("outcome") == "extinction"]
        n_cool = sum(str(r.get("cool_flame")).lower() == "true" for r in rs)
        accs = sorted({r["accession"] for r in rs})
        rec: dict = {
            "id": inv,
            "data": {
                "availability": "full",
                "psiUrl": f"https://psi.nasa.gov/physci/repo/data/investigation/{accs[0]}",
            },
            "psiRuns": len(rs),
            "psiAccessions": accs,
            "psiFuels": sorted({r["fuel"] for r in rs if r.get("fuel")}),
        }
        if o2s:
            rec["psiO2RangePct"] = [min(o2s), max(o2s)]
        if exts:
            rec["psiExtinctionLimitPct"] = {"min": min(exts), "max": max(exts)}
        # flag the investigation only when cool flames are a real signature
        # of the dataset (>=5% of runs) — avoids tagging every fuel of an
        # investigation that ran a handful of cool-flame test points
        if n_cool / len(rs) >= 0.05:
            rec["metrics"] = {"coolFlameObserved": True}
        records.append(rec)

    out = ROOT / "raw" / "structured"
    out.mkdir(parents=True, exist_ok=True)
    (out / "psi_experiments.json").write_text(
        json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[OK] {len(records)} structured records -> "
          f"raw/structured/psi_experiments.json")


if __name__ == "__main__":
    raise SystemExit(main())
