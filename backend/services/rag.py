"""Deterministic retrieval + SQL-RAG over the pipeline corpus.

Two channels, one interface:

1. Document retrieval (BM25-lite) over data/processed/search_index.json —
   investigation records, normalized experiment runs, NTRS citations and
   PSI file entries. No embedding service: fully offline and reproducible.

2. Structured answers (SQL-RAG) over data/processed/experiments.csv via
   DuckDB — engineering questions like "lowest O2 that sustained heptane
   combustion" are answered with exact experiment rows and citations.
"""
from __future__ import annotations

import json
import logging
import math
import re
import threading
from collections import Counter
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "data" / "processed" / "search_index.json"
EXPERIMENTS = ROOT / "data" / "processed" / "experiments.csv"
CITATIONS = ROOT / "data" / "processed" / "citations.json"

TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9._-]*")
STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
    "at", "by", "is", "are", "was", "were", "be", "been", "as", "that",
    "this", "it", "its", "from", "into", "what", "which", "how", "does",
    "did", "do", "many", "much", "show", "tell", "me", "about", "between",
    "than", "then", "there", "their", "when", "where", "who", "why",
    "during", "per", "via", "under", "over", "can", "could", "would",
}

# explicit investigation names/acronyms -> ids (checked first)
INV_ALIASES = {
    "flex": "flex-2", "flex-2": "flex-2",
    "cfi": "acme", "cfi-g": "acme",          # PSI-159 is ACME CFI-G
    "acme": "acme", "slice": "acme", "bre": "acme", "cld": "acme",
    "sofie": "sofie-gel", "sofie-gel": "sofie-gel",
    "bass": "bass-ii", "bass-ii": "bass-ii",
    "saffire": "saffire", "cygnus": "saffire",
    "same": "same", "damf": "same",
    "confined": "confined-combustion",
    "flare": "flare", "partial-g": "flare",
}
# topic terms that only ground a query when no explicit name matched —
# "ACME cool flame" must resolve to acme, not the cool-flame default
TOPIC_DEFAULTS = {
    "cool flame": "flex-2", "cool flames": "flex-2",
    "smoke": "same", "aerosol": "same",
    "partial gravity": "flare",
}

# fuel grounding — keep in sync with FUEL_ID in normalize_experiments.py;
# "methane" must precede "ethane" or "methane" mis-extracts as "ethane"
FUEL_RE = re.compile(
    r"heptane?|methanol|meoh|ethanol|butanol|iso.?octane|decanol|decane|"
    r"nonane|ethylene|c2h4|methane|ch4|ethane|c2h6|propane|c3h8|butane|"
    r"c4h10|jp.?8|jet|pmma|acrylic|cotton|sibal|nomex|polycarbonate|"
    r"teflon|kapton|pyrell|silicone|cellulose|paper|cardboard",
    re.IGNORECASE)

_docs: list[dict] = []
_idf: dict[str, float] = {}
_ready = False
_duck = None
# one lock guards lazy init AND every query: a shared DuckDB connection's
# result stream is not thread-safe, so each query also runs on its own
# cursor while the lock serializes execute+fetch+description
_lock = threading.Lock()


def _load() -> None:
    global _docs, _idf, _ready, _duck
    if _ready:
        return
    with _lock:
        if _ready:
            return
        _ready = True
        if INDEX.exists():
            _docs = json.loads(INDEX.read_text()).get("documents", [])
        df: Counter = Counter()
        for d in _docs:
            df.update(set(d.get("tokens", [])))
        n = max(1, len(_docs))
        _idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
        if EXPERIMENTS.exists():
            try:
                import duckdb  # noqa: PLC0415
                _duck = duckdb.connect(":memory:")
                _duck.execute(
                    "CREATE TABLE experiments AS SELECT * FROM read_csv_auto(?, "
                    "header=true)", [str(EXPERIMENTS)])
            except Exception as exc:  # noqa: BLE001 - degrade to search only
                logger.warning("duckdb unavailable, sql-rag disabled: %s", exc)
                _duck = None


def _duck_query(sql: str, params: list | None = None
                ) -> tuple[list[tuple], list[str]]:
    """Run a read query on an isolated cursor; returns (rows, col_names)."""
    with _lock:
        cur = _duck.cursor()
        try:
            cur.execute(sql, params or [])
            rows = cur.fetchall()
            cols = [c[0] for c in cur.description]
            return rows, cols
        finally:
            cur.close()


def reload() -> None:
    global _ready
    _ready = False
    _load()


def qtokens(q: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(q.lower()) if t not in STOP and len(t) > 1]


def _snippet(text: str, terms: list[str], width: int = 160) -> str:
    low = text.lower()
    pos = min((low.find(t) for t in terms if low.find(t) >= 0), default=-1)
    if pos < 0:
        return text[:width].strip() + ("…" if len(text) > width else "")
    a = max(0, pos - 40)
    b = min(len(text), pos + width)
    return ("…" if a else "") + text[a:b].strip() + ("…" if b < len(text) else "")


def _score(doc: dict, terms: list[str], boosts: dict[str, float]) -> float:
    if not terms:
        return 0.0
    toks = doc.get("tokens", [])
    if not toks:
        return 0.0
    counts = Counter(toks)
    k1, b = 1.4, 0.65
    avg = 220.0
    s = 0.0
    for t in terms:
        tf = counts.get(t, 0)
        if not tf:
            continue
        idf = _idf.get(t, math.log(1 + len(_docs)))
        s += boosts.get(t, 1.0) * idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * len(toks) / avg))
    # type priors: real runs and citations beat file names
    s *= {"experiment": 1.15, "citation": 1.1, "investigation": 1.05,
          "psi-file": 0.8}.get(doc["type"], 1.0)
    return s


def _alias_in_text(alias: str, low: str) -> bool:
    """Whole-token (or whole-phrase) match — 'bre' must not fire inside
    'breakdown', and 'flex' must not swallow 'flex-2'."""
    return re.search(r"(?<![a-z0-9_-])" + re.escape(alias) +
                     r"(?![a-z0-9_-])", low) is not None


def _ground(q: str) -> tuple[list[str], str | None, str | None]:
    """(terms, investigation_id, fuel_token) extracted from the question."""
    low = q.lower()
    inv = None
    for alias, iid in INV_ALIASES.items():
        if _alias_in_text(alias, low):
            inv = iid
            break
    if inv is None:
        for topic, iid in TOPIC_DEFAULTS.items():
            if _alias_in_text(topic, low):
                inv = iid
                break
    fm = FUEL_RE.search(low)
    fuel = fm.group(0).lower() if fm else None
    return qtokens(q), inv, fuel


def search(q: str, k: int = 8) -> dict:
    _load()
    terms, inv, fuel = _ground(q)
    boosts = {t: 1.6 for t in terms if t in {inv, fuel}}
    scored = []
    for d in _docs:
        if inv and d.get("investigationId") not in (None, inv):
            continue
        s = _score(d, terms, boosts)
        if s > 0:
            scored.append((s, d))
    scored.sort(key=lambda x: -x[0])
    return {
        "query": q,
        "grounding": {"investigationId": inv, "fuel": fuel, "terms": terms},
        "results": [{
            "id": d["id"], "type": d["type"], "title": d["title"],
            "score": round(s, 3),
            "snippet": _snippet(d["text"], terms),
            "url": d.get("url"), "meta": d.get("meta", {}),
        } for s, d in scored[:k]],
        "total": len(scored),
    }


def _cite(doc: dict) -> dict:
    m = doc.get("meta", {})
    if doc["type"] == "experiment":
        label = f"PSI {doc.get('accession')} · run {doc['id'].split(':')[-1]}"
    elif doc["type"] == "citation":
        label = f"NTRS {doc['id'].split(':')[-1]}" + \
                (f" ({m['year']})" if m.get("year") else "")
    elif doc["type"] == "psi-file":
        label = f"PSI {doc.get('accession')} · {doc['title']}"
    else:
        label = doc.get("accession") or doc["id"]
    return {"label": label, "title": doc["title"], "url": doc.get("url"),
            "type": doc["type"], "meta": m}


def _sql_answer(q: str, terms: list[str], inv: str | None,
                fuel: str | None) -> dict | None:
    """Route aggregating questions to DuckDB over the normalized table."""
    if _duck is None:
        return None
    low = q.lower()
    # dynamic filters are bound parameters — never interpolate question
    # text (or anything derived from it) into SQL
    where_extra: list[str] = []
    params: list = []
    if inv:
        where_extra.append("investigation_id = ?")
        params.append(inv)
    if fuel:
        where_extra.append("lower(fuel) LIKE ?")
        params.append(f"%{fuel}%")
    extra = (" AND " + " AND ".join(where_extra)) if where_extra else ""
    burned = "outcome IN ('burnout','disruption')"

    def run(sql: str, ps: list | None = None):
        rows, cols = _duck_query(sql, ps)
        return [dict(zip(cols, r)) for r in rows]

    try:
        if re.search(r"lowest|minimum|min\b|least", low) and "o2" in low:
            rows = run(
                "SELECT run_id, accession, fuel, o2_pct, outcome, source_file "
                f"FROM experiments WHERE {burned}{extra} "
                "ORDER BY o2_pct ASC LIMIT 5", params)
            if rows:
                top = rows[0]
                answer = (f"Lowest O2 that still sustained combustion: "
                          f"{top['o2_pct']}% ({top['fuel']}, run {top['run_id']}, "
                          f"{top['accession']}).")
                return {"answer": answer, "sql": True, "rows": rows}
        if re.search(r"how many|count|number of", low):
            where = ("outcome = 'extinction'" if "extinct" in low
                     else "1=1")
            if "cool flame" in low:
                where += " AND cool_flame = true"
            rows = run(
                "SELECT investigation_id, accession, COUNT(*) AS runs "
                f"FROM experiments WHERE {where}{extra} "
                "GROUP BY 1,2 ORDER BY runs DESC", params)
            if rows:
                total = sum(r["runs"] for r in rows)
                answer = (f"{total} matching test runs across "
                          f"{len(rows)} investigations/studies.")
                return {"answer": answer, "sql": True, "rows": rows}
        if re.search(r"burn(ing)? rate|k ?avg|fastest", low):
            rows = run(
                "SELECT run_id, accession, fuel, o2_pct, burn_rate_mm2_s "
                "FROM experiments WHERE burn_rate_mm2_s IS NOT NULL"
                f"{extra} "
                "ORDER BY burn_rate_mm2_s DESC LIMIT 5", params)
            if rows:
                top = rows[0]
                answer = (f"Highest measured burning-rate constant: "
                          f"{top['burn_rate_mm2_s']} mm²/s ({top['fuel']}, "
                          f"run {top['run_id']}).")
                return {"answer": answer, "sql": True, "rows": rows}
        if "cool flame" in low:
            rows = run(
                "SELECT run_id, accession, fuel, o2_pct, outcome "
                f"FROM experiments WHERE cool_flame = true{extra} "
                "LIMIT 6", params)
            if rows:
                total = run(
                    "SELECT COUNT(*) AS n FROM experiments "
                    f"WHERE cool_flame = true{extra}", params)[0]["n"]
                fuels = sorted({r["fuel"] for r in rows if r.get("fuel")})
                return {"answer": f"{total} cool-flame runs in the PSI "
                                  f"corpus (fuels: {', '.join(fuels)}). "
                                  "Cool flames burn below detection — a "
                                  "key hidden-fire hazard.",
                        "sql": True, "rows": rows}
    except Exception as exc:  # noqa: BLE001 - fall back to retrieval
        logger.warning("sql-rag failed, using retrieval fallback: %s", exc)
        return None
    return None


def ask(q: str, k: int = 6) -> dict:
    _load()
    terms, inv, fuel = _ground(q)

    sql = _sql_answer(q, terms, inv, fuel)
    hits = search(q, k)["results"]
    citations = []
    seen = set()
    for h in hits:
        doc = next((d for d in _docs if d["id"] == h["id"]), None)
        if doc and doc["id"] not in seen:
            citations.append(_cite(doc))
            seen.add(doc["id"])

    if sql and sql.get("answer"):
        return {
            "query": q, "mode": "sql-rag",
            "answer": sql["answer"],
            "rows": sql.get("rows", []),
            "citations": citations[:k],
            "grounding": {"investigationId": inv, "fuel": fuel},
        }

    # semantic answer: compose from top evidence docs
    bullets = []
    for h in hits[:4]:
        tag = {"experiment": "PSI test", "citation": "NTRS paper",
               "investigation": "investigation", "psi-file": "PSI file"}.get(
            h["type"], "record")
        bullets.append(f"[{tag}: {h['title']}] {_snippet_for_answer(h)}")
    answer = (
        "Top evidence from the PSI/NTRS corpus:\n- " + "\n- ".join(bullets)
        if bullets else
        "No matching records. Try naming an investigation (FLEX, ACME, "
        "BASS-II, Saffire, SAME) or a fuel (heptane, PMMA, cotton).")
    return {
        "query": q, "mode": "retrieval",
        "answer": answer,
        "rows": [],
        "citations": citations[:k],
        "grounding": {"investigationId": inv, "fuel": fuel},
    }


def _snippet_for_answer(hit: dict) -> str:
    s = hit.get("snippet", "")
    return s if len(s) <= 200 else s[:200] + "…"


def stats() -> dict:
    _load()
    types = Counter(d["type"] for d in _docs)
    n_rows = None
    if _duck is not None:
        try:
            rows, _ = _duck_query("SELECT COUNT(*) FROM experiments")
            n_rows = rows[0][0]
        except Exception:  # noqa: BLE001
            pass
    return {"documents": len(_docs), "byType": dict(types),
            "experimentRows": n_rows, "sqlEnabled": _duck is not None}
