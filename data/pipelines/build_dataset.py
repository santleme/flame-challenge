"""Build frontend/src/data/investigations.json from raw PSI/NTRS downloads.

Pipeline:
    1. pipelines/psi_search.py  -> data/raw/psi_search_*.json + psi_investigations.json
    2. pipelines/ntrs_search.py -> data/raw/ntrs_*.json + ntrs_citations.json
    3. pipelines/build_dataset.py -> frontend/src/data/investigations.json

This script:
    - with no structured records: keeps the current starter dataset (no-op)
    - with --sample: restores the bundled starter dataset
    - with structured records under data/raw/structured/*.json
      (schema: docs/data-schema.md): merges them into the dataset

Usage:
    python data/pipelines/build_dataset.py            # merge raw data if present
    python data/pipelines/build_dataset.py --sample   # restore starter dataset
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # data/
REPO = ROOT.parent
DATASET_PATH = REPO / "frontend" / "src" / "data" / "investigations.json"
STRUCTURED_DIR = ROOT / "raw" / "structured"
STARTER_PATH = ROOT / "investigations.starter.json"


def _rel(path: Path) -> str:
    """repo-relative display path; falls back to absolute when the path
    lives outside the repo (monkeypatched tests, relocated outputs)"""
    try:
        return path.relative_to(REPO).as_posix()
    except ValueError:
        return str(path)

# Keep a pristine copy of the starter dataset for --sample restores.
def ensure_starter_backup() -> None:
    if not STARTER_PATH.exists() and DATASET_PATH.exists():
        STARTER_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(DATASET_PATH, STARTER_PATH)


def restore_starter() -> None:
    ensure_starter_backup()
    if STARTER_PATH.exists():
        shutil.copy(STARTER_PATH, DATASET_PATH)
        print(f"[OK] starter dataset restored -> {_rel(DATASET_PATH)}")
    else:
        print("[FAIL] no starter backup found", file=sys.stderr)
        sys.exit(1)


def merge_structured() -> None:
    records: list[dict] = []
    if STRUCTURED_DIR.exists():
        for path in sorted(STRUCTURED_DIR.glob("*.json")):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                print(f"[SKIP] {path.name}: invalid JSON ({exc})", file=sys.stderr)
                continue
            items = payload if isinstance(payload, list) else [payload]
            for item in items:
                if isinstance(item, dict) and item.get("id"):
                    records.append(item)

    if not records:
        print(
            "[INFO] no structured records under data/raw/structured/ — "
            "keeping current dataset.\n"
            "       Add normalized records there (schema: docs/data-schema.md) "
            "or run data/pipelines/psi_search.py + ntrs_search.py first."
        )
        return

    # Merge: structured records override same-id starter records; nested
    # objects (conditions/metrics/data) merge key-wise so partial records
    # don't drop sibling fields.
    dataset = json.loads(DATASET_PATH.read_text(encoding="utf-8"))
    merged = {inv["id"]: inv for inv in dataset.get("investigations", [])}
    for rec in records:
        rec["verified"] = True  # records built from real downloads are verified
        base = merged.get(rec["id"], {})
        for k, v in rec.items():
            if isinstance(v, dict) and isinstance(base.get(k), dict):
                base[k] = {**base[k], **v}
            else:
                base[k] = v
        merged[rec["id"]] = base

    dataset["investigations"] = list(merged.values())
    dataset["generated"] = "psi-ntrs-pipeline"
    DATASET_PATH.write_text(
        json.dumps(dataset, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"[OK] merged {len(records)} records -> {_rel(DATASET_PATH)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", action="store_true", help="restore starter dataset")
    args = parser.parse_args()

    if args.sample:
        restore_starter()
    else:
        ensure_starter_backup()
        merge_structured()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
