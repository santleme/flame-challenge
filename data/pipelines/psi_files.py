"""List and selectively download data files from PSI studies.

The PSI file API (discovered from the repository frontend):

    POST /geode-py/ws/files/v2
        {"folder": "", "fileType": "study", "studyId": "PSI-69",
         "version": "1", "obfuscationcode": ""}
        -> file tree; leaves carry {id, key (real path), bytes_size, version}

    GET /geode-py/ws/studies/<ACC>/download?redirect=false
        with a JSON body {"file": <leaf-id>, "version": "1"}
        -> presigned S3 URL (plain text). Fetch it with NO extra headers.

This script downloads only small, analysis-friendly files (test sheets,
comments, readmes, CSVs, logs, metadata) — raw sensor zips/videos stay in
the archive and are recorded in the manifest as downloadable references.

Usage:
    python data/pipelines/psi_files.py --all
    python data/pipelines/psi_files.py PSI-69 PSI-68 --max-files 400
    python data/pipelines/psi_files.py --list-only PSI-69
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # data/
RAW_DIR = ROOT / "raw"
FILES_DIR = RAW_DIR / "files"
PSI_API = "https://psi.nasa.gov/geode-py/ws"

HEADERS = {
    "User-Agent": "flame-in-freefall-hackathon/0.1 (NASA Space Apps 2026)",
    "Content-Type": "application/json",
}

# In-scope studies for the challenge (accession -> investigation id used in app)
TARGET_STUDIES = {
    "PSI-69": "flex-2",    # Flame Extinguishment Experiment
    "PSI-68": "flex-2",    # Flame Extinguishment Experiment - 2
    "PSI-39": "flex-2",    # Cool Flames Investigation
    "PSI-142": "flex-2",   # Cool Flame Transitions
    "PSI-117": "flex-2",   # Cool Flame Dynamics perturbation
    "PSI-10": "acme",      # ACME / Flame Design
    "PSI-20": "acme",      # ACME / Burning Rate Emulator
    "PSI-21": "acme",      # ACME / Coflow Laminar Diffusion
    "PSI-22": "acme",      # ACME / Electric-Field Effects
    "PSI-23": "acme",      # ACME / Spherical diffusion flames
    "PSI-106": "acme",     # SLICE
    "PSI-107": "acme",     # Smoke Point In Co-flow
    "PSI-159": "acme",     # ACME Cool Flames
    "PSI-26": "bass-ii",   # BASS
    "PSI-25": "bass-ii",   # BASS-II
    "PSI-98": "saffire",   # Saffire-I
    "PSI-99": "saffire",   # Saffire-II
    "PSI-100": "saffire",  # Saffire-III
    "PSI-101": "same",     # SAME reflight
    "PSI-102": "same",     # SAME
    "PSI-115": "same",     # SAME data modeling
    "PSI-47": "same",      # Dust & Aerosol Measurement Feasibility
    "PSI-60": "acme",      # SPICE data analysis
    "PSI-62": "confined-combustion",  # Concurrent flame spread modeling
    "PSI-179": "same",     # Aerosol Sampling Experiment
}

# extensions we can actually mine offline
KEEP_EXT = {"txt", "csv", "tsv", "xml", "json", "log", "meta", "metadata",
            "asc", "xls", "xlsx", "dat", "ini", "cfg", "md", "htm", "html"}
# tabular data gets download preference over logs/comments after priority names
DATA_EXT = {"csv", "tsv", "xls", "xlsx", "dat"}
# name patterns that get download priority — structured per-test parameter
# sheets first (they carry fuel/O2/pressure/extinction fields), then other
# ops docs. Ordering matters: test sheets outrank free-text comments.
TIER0_RE = re.compile(r"testsheet|test_?sheet|run_?sheet|matrix|eird",
                      re.IGNORECASE)
TIER1_RE = re.compile(
    r"comments?|readme|summary|conditions?|parameters?|test_?plan|"
    r"metadata|procedure|test_?point|_tp\b|mdipsug",
    re.IGNORECASE,
)


def post(path: str, body: dict, limit: int | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(
        PSI_API + path, data=json.dumps(body).encode(), headers=HEADERS,
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read()[:limit]
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:400]


def get_presigned(accession: str, file_id: str, version: int = 1) -> str | None:
    # oddity of the PSI API: presign is a GET that requires a JSON body
    req = urllib.request.Request(
        f"{PSI_API}/studies/{accession}/download?redirect=false",
        data=json.dumps({"file": file_id, "version": str(version)}).encode(),
        headers=HEADERS, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                return None
            return resp.read().decode().strip()
    except (urllib.error.HTTPError, urllib.error.URLError):
        return None


def get_clean(url: str, limit: int | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={})  # presigned: no extra headers
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read()[:limit]
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200]


def tree_leaves(tree: dict) -> list[dict]:
    out: list[dict] = []
    def walk(n: dict) -> None:
        if n.get("files"):
            for c in n["files"]:
                walk(c)
        elif n.get("key"):
            out.append(n)
    walk(tree)
    return out


def fetch_tree(accession: str) -> list[dict] | None:
    code, body = post("/files/v2",
                      {"folder": "", "fileType": "study",
                       "studyId": accession, "version": "1",
                       "obfuscationcode": ""}, limit=64_000_000)
    if code != 200:
        print(f"[FAIL] {accession} tree -> {code} {body[:150]}", file=sys.stderr)
        return None
    try:
        return tree_leaves(json.loads(body))
    except json.JSONDecodeError:
        print(f"[FAIL] {accession} tree: bad JSON", file=sys.stderr)
        return None


def select_files(leaves: list[dict], max_kb: int, max_files: int) -> list[dict]:
    """Pick analysis-friendly files: preferred names first, then by ext+size."""
    def keep(n: dict) -> bool:
        ext = n["key"].rsplit(".", 1)[-1].lower() if "." in n["key"] else ""
        return ext in KEEP_EXT and n.get("bytes_size", 0) <= max_kb * 1024

    cands = [n for n in leaves if keep(n)]
    def rank(n: dict) -> tuple:
        ext = n["key"].rsplit(".", 1)[-1].lower() if "." in n["key"] else ""
        if TIER0_RE.search(n["key"]):
            tier = 0
        elif ext in DATA_EXT:
            tier = 1
        elif TIER1_RE.search(n["key"]):
            tier = 2
        else:
            tier = 3
        return (tier, n.get("bytes_size", 0))
    cands.sort(key=rank)
    return cands[:max_files]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("accessions", nargs="*", help="PSI accession ids")
    ap.add_argument("--all", action="store_true",
                    help="use the built-in combustion study list")
    ap.add_argument("--list-only", action="store_true",
                    help="save file trees only, no downloads")
    ap.add_argument("--max-kb", type=int, default=64,
                    help="max file size to download (default 64 KB)")
    ap.add_argument("--max-files", type=int, default=800,
                    help="max downloads per study (default 800)")
    ap.add_argument("--sleep", type=float, default=0.0,
                    help="delay between downloads (default 0)")
    ap.add_argument("--workers", type=int, default=12,
                    help="parallel download workers (default 12)")
    args = ap.parse_args()

    accs = args.accessions or (list(TARGET_STUDIES) if args.all else [])
    if not accs:
        ap.error("pass accessions or --all")

    for acc in accs:
        acc_dir = FILES_DIR / acc
        acc_dir.mkdir(parents=True, exist_ok=True)
        leaves = fetch_tree(acc)
        if leaves is None:
            continue

        manifest = acc_dir / "_manifest.json"
        manifest.write_text(json.dumps({
            "accession": acc,
            "investigation": TARGET_STUDIES.get(acc),
            "fileCount": len(leaves),
            "files": [{
                "id": n["id"], "key": n["key"],
                "bytes": n.get("bytes_size", 0),
                "version": n.get("version", 1),
                "restricted": n.get("restricted", False),
            } for n in leaves],
        }), encoding="utf-8")
        ext = collections.Counter(
            n["key"].rsplit(".", 1)[-1].lower() for n in leaves if "." in n["key"])
        print(f"[TREE] {acc} ({TARGET_STUDIES.get(acc, '?')}): "
              f"{len(leaves)} files | "
              + ", ".join(f"{e}:{c}" for e, c in ext.most_common(5)))

        if args.list_only:
            continue

        chosen = select_files(leaves, args.max_kb, args.max_files)

        def grab(n: dict) -> bool:
            name = n["key"].rsplit("/", 1)[-1]
            safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:120]
            dest = acc_dir / f"{n['id']}_{safe}"
            if dest.exists() and dest.stat().st_size > 0:
                return True
            url = get_presigned(acc, n["id"], int(n.get("version", 1)))
            if not url:
                return False
            code, body = get_clean(url, limit=args.max_kb * 1024 * 4)
            if code == 200 and not body.startswith(b"<?xml"):
                dest.write_bytes(body)
                if args.sleep:
                    time.sleep(args.sleep)
                return True
            return False

        ok = fail = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futs = {pool.submit(grab, n): n for n in chosen}
            done = 0
            for fut in as_completed(futs):
                try:
                    if fut.result():
                        ok += 1
                    else:
                        fail += 1
                except Exception:  # noqa: BLE001
                    fail += 1
                done += 1
                if done % 200 == 0:
                    print(f"       {acc}: {done}/{len(chosen)} "
                          f"({ok} ok, {fail} failed)", flush=True)
        print(f"[DL]   {acc}: {ok} saved, {fail} failed "
              f"-> {acc_dir.relative_to(ROOT)}", flush=True)

    print("\nNext: python data/pipelines/normalize_experiments.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
