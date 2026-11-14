"""Build the retrieval index for the SI/RAG layer.

Merges every corpus the pipeline produces into one document store that the
backend serves (deterministic, offline — no embeddings service needed):

    data/raw/psi_investigations.json      PSI catalog metadata (27 records)
    data/bundle/investigations.json       curated app dataset
    data/processed/experiments.json       normalized per-test rows
    data/raw/ntrs_citations.json          NTRS citation catalog
    data/raw/files/<ACC>/_manifest.json   PSI file inventories

Outputs:
    data/processed/search_index.json   documents[] with fields:
        id, type (investigation|experiment|citation|psi-file),
        title, text, tokens (pre-tokenized), investigationId,
        accession, url, meta{}
    data/processed/citations.json      slim citation catalog for the API

Usage:
    python data/pipelines/build_index.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # data/
RAW = ROOT / "raw"
OUT = ROOT / "processed"
DATASET = ROOT / "bundle" / "investigations.json"

STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
    "at", "by", "is", "are", "was", "were", "be", "been", "as", "that",
    "this", "it", "its", "from", "into", "during", "per", "via", "et",
    "al", "under", "over", "between", "than", "then", "such", "these",
    "those", "their", "they", "them", "we", "our", "us", "using", "use",
}
TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9._-]*")


def tokens(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(text.lower()) if t not in STOP and len(t) > 1]


def doc(did, dtype, title, text, inv=None, acc=None, url=None, **meta):
    return {
        "id": did, "type": dtype, "title": title, "text": text[:4000],
        "tokens": tokens(f"{title} {text}"), "investigationId": inv,
        "accession": acc, "url": url, "meta": meta,
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    docs: list[dict] = []

    # --- curated dataset records ---
    if DATASET.exists():
        ds = json.loads(DATASET.read_text())
        for inv in ds.get("investigations", []):
            body = " ".join([
                inv.get("title", ""), " ".join(inv.get("keyFindings", [])),
                " ".join(inv.get("safetyImplications", [])),
                " ".join(inv.get("fuels", [])), inv.get("platform", ""),
                inv.get("facility") or "", inv.get("category", ""),
            ])
            docs.append(doc(
                f"inv:{inv['id']}", "investigation", inv.get("name", inv["id"]),
                body, inv=inv["id"],
                url=(inv.get("data") or {}).get("psiUrl"),
                years=inv.get("years"), gravity=inv.get("gravity"),
                verified=inv.get("verified"), hazards=inv.get("hazards", []),
            ))
        print(f"[OK] {len(docs)} investigation docs from dataset")

    # --- PSI catalog metadata ---
    cat_path = RAW / "psi_investigations.json"
    if cat_path.exists():
        n0 = len(docs)
        for rec in json.loads(cat_path.read_text()):
            acc = rec.get("Accession", "")
            body = " ".join(str(rec.get(k) or "") for k in (
                "Title", "Objectives", "Approach", "Hypothesis",
                "Keywords", "SubResearch Area", "Flight Platform",
                "Monitoring Center"))
            docs.append(doc(
                f"psi:{acc}", "investigation", rec.get("Title", acc),
                body, acc=acc,
                url=f"https://psi.nasa.gov/physci/repo/data/investigation/{acc}",
                researchArea=rec.get("Research Area"),
                acronym=rec.get("Acronym"),
                flightPlatform=rec.get("Flight Platform"),
            ))
        print(f"[OK] +{len(docs)-n0} PSI catalog docs")

    # --- normalized experiment rows ---
    exp_path = OUT / "experiments.json"
    if exp_path.exists():
        exps = json.loads(exp_path.read_text()).get("experiments", [])
        n0 = len(docs)
        for r in exps:
            txt = (
                f"{r['run_id']} {r.get('fuel') or ''} O2 {r.get('o2_pct')}% "
                f"pressure {r.get('pressure_kpa')}kPa "
                f"flow {r.get('flow_cms')}cm/s outcome {r.get('outcome')} "
                f"{r.get('comments', '')}"
            )
            docs.append(doc(
                f"exp:{r['accession']}:{r['run_id']}", "experiment",
                f"{r['run_id']} ({r.get('fuel') or '?'})",
                txt, inv=r["investigation_id"], acc=r["accession"],
                url=r.get("source_url"),
                o2Pct=r.get("o2_pct"), outcome=r.get("outcome"),
                materialId=r.get("material_id"), sourceFile=r.get("source_file"),
            ))
        print(f"[OK] +{len(docs)-n0} experiment docs")

    # --- NTRS citations ---
    cit_path = RAW / "ntrs_citations.json"
    citations_out = []
    if cit_path.exists():
        cat = json.loads(cit_path.read_text())
        n0 = len(docs)
        for cid, rec in cat.items():
            pdf = next((d.get("pdf") for d in rec.get("downloads", [])
                        if d.get("pdf")), None)
            citations_out.append({
                "id": cid, "title": rec.get("title"), "year": rec.get("year"),
                "authors": rec.get("authors", []), "center": rec.get("center"),
                "ntrsUrl": rec.get("ntrsUrl"),
                "pdfUrl": ("https://ntrs.nasa.gov" + pdf) if pdf else None,
                "investigationIds": rec.get("investigationIds", []),
            })
            docs.append(doc(
                f"ntrs:{cid}", "citation", rec.get("title", cid),
                f"{rec.get('abstract') or ''} {' '.join(rec.get('authors', []))}",
                inv=(rec.get("investigationIds") or [None])[0],
                url=rec.get("ntrsUrl"), year=rec.get("year"),
                pdfUrl=pdf, authors=rec.get("authors", []),
            ))
        print(f"[OK] +{len(docs)-n0} NTRS citation docs")

    # --- PSI file inventory docs (searchable file names only) ---
    n0 = len(docs)
    for manifest in sorted((RAW / "files").glob("*/_manifest.json")):
        m = json.loads(manifest.read_text())
        acc = m["accession"]
        for f in m.get("files", []):
            key = f["key"]
            name = key.rsplit("/", 1)[-1]
            if not re.search(r"\.(txt|csv|tsv|xls|xlsx|pdf|docx?|meta|json)$",
                             name, re.I):
                continue
            docs.append(doc(
                f"file:{acc}:{f['id']}", "psi-file", name,
                f"{key} ({f['bytes']/1024:.0f} KB)", acc=acc,
                inv=m.get("investigation"),
                url=f"https://psi.nasa.gov/physci/repo/data/investigation/{acc}",
                fileId=f["id"], bytes=f["bytes"], key=key,
            ))
    print(f"[OK] +{len(docs)-n0} PSI file docs")

    (OUT / "search_index.json").write_text(json.dumps({
        "generated": "build_index.py",
        "docCount": len(docs),
        "documents": docs,
    }, ensure_ascii=False), encoding="utf-8")
    (OUT / "citations.json").write_text(json.dumps({
        "generated": "build_index.py", "count": len(citations_out),
        "citations": citations_out,
    }, ensure_ascii=False), encoding="utf-8")

    print(f"\n[DONE] {len(docs)} documents -> processed/search_index.json, "
          f"{len(citations_out)} citations -> processed/citations.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
