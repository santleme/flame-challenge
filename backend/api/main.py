"""Freefall Foundry backend — serves the C++ physics core over HTTP + WebSocket.

Run (from repo root, venv active):
    uvicorn backend.api.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
import math
import time

from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backend.services import engine_bridge as eb
from backend.services import neighbors, rag, risk, tactics

app = FastAPI(title="Freefall Foundry Engine API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Physical bounds for atmosphere/config inputs. O₂ is a percentage; the
# calibrated flow data tops out ~70 cm/s and pressures are 57–101 kPa, so
# the upper bounds below leave generous headroom while still rejecting
# pathological values (negative, NaN/inf, >32-bit seeds) with a 422
# instead of letting them reach the engine as a 500.
_O2 = {"ge": 0.0, "le": 100.0, "allow_inf_nan": False}
_FLOW = {"ge": 0.0, "le": 300.0, "allow_inf_nan": False}
_PRESSURE = {"ge": 1.0, "le": 300.0, "allow_inf_nan": False}
_SEED = {"ge": 0, "le": 4_294_967_295}  # C++ unsigned int


@app.exception_handler(eb.UnknownInvestigationError)
def unknown_investigation(_: Request,
                          exc: eb.UnknownInvestigationError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


def _json_safe(value):
    """Replace non-finite floats recursively so the payload serializes —
    a rejected `1e309`/`NaN` input would otherwise turn the 422 into a 500."""
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")[:2000]
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


@app.exception_handler(RequestValidationError)
async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
    # same shape as FastAPI's default 422 handler, but sanitized
    try:
        content = jsonable_encoder({"detail": _json_safe(exc.errors()),
                                    "body": _json_safe(exc.body)})
    except Exception:
        content = {"detail": "Invalid request body",
                   "type": "request_validation"}
    return JSONResponse(status_code=422, content=content)


class PreviewReq(BaseModel):
    investigationId: str
    o2Pct: float = Field(**_O2)
    flowCms: float | None = Field(default=None, **_FLOW)
    pressureKpa: float | None = Field(default=None, **_PRESSURE)


class ChamberReq(BaseModel):
    investigationId: str
    o2Pct: float = Field(**_O2)
    flowCms: float | None = Field(default=None, **_FLOW)
    pressureKpa: float | None = Field(default=None, **_PRESSURE)
    seed: int = Field(default=1, **_SEED)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "engine": eb.ENGINE, "module": eb.MODULE}


@app.get("/api/materials")
def get_materials() -> dict:
    return {"materials": eb.materials(), "investigations": eb.investigation_map()}


@app.post("/api/chamber/preview")
def chamber_preview(req: PreviewReq) -> dict:
    return eb.preview(req.investigationId, req.o2Pct, req.flowCms,
                      req.pressureKpa)


# ---------- SI layer: retrieval, SQL-RAG, risk simulator ----------

class AskReq(BaseModel):
    q: str
    k: int = 6


class RiskReq(BaseModel):
    materialId: str = "pmma"
    o2Pct: float = Field(default=21.0, **_O2)
    flowCms: float = Field(default=0.0, **_FLOW)
    gravity: str = "microgravity"


@app.get("/api/rag/stats")
def rag_stats() -> dict:
    return rag.stats()


@app.get("/api/search")
def api_search(q: str, k: int = 8) -> dict:
    return rag.search(q, k)


@app.post("/api/ask")
def api_ask(req: AskReq) -> dict:
    return rag.ask(req.q, req.k)


@app.post("/api/risk")
def api_risk(req: RiskReq) -> dict:
    return risk.risk_index(req.materialId, req.o2Pct, req.flowCms, req.gravity)


@app.get("/api/risk")
def api_risk_get(materialId: str = "pmma",
                 o2Pct: float = Query(21.0, ge=0.0, le=100.0,
                                      allow_inf_nan=False),
                 flowCms: float = Query(0.0, ge=0.0, le=300.0,
                                        allow_inf_nan=False),
                 gravity: str = "microgravity") -> dict:
    return risk.risk_index(materialId, o2Pct, flowCms, gravity)


@app.get("/api/risk/curve")
def api_risk_curve(materialId: str = "pmma",
                   flowCms: float = Query(0.0, ge=0.0, le=300.0,
                                          allow_inf_nan=False),
                   gravity: str = "microgravity",
                   o2Min: float = Query(8.0, ge=0.0, le=100.0,
                                        allow_inf_nan=False),
                   o2Max: float = Query(40.0, ge=0.0, le=100.0,
                                        allow_inf_nan=False)) -> dict:
    return risk.curve(materialId, flowCms, gravity, o2Min, o2Max)


@app.get("/api/risk/materials")
def api_risk_materials() -> dict:
    return {"materials": risk.materials()}


# ---------- SI layer: KNN lookup + deterministic tactical synthesis ----------

@app.get("/api/neighbors")
def api_neighbors(materialId: str = "pmma", o2Pct: float = 21.0,
                  flowCms: float = 0.0, k: int = 3) -> dict:
    """k nearest real PSI test runs to the requested operating point."""
    return {
        "materialId": materialId, "o2Pct": o2Pct, "flowCms": flowCms,
        "neighbors": neighbors.nearest(materialId, o2Pct, flowCms, k),
    }


@app.get("/api/decision-cards")
def api_decision_cards(materialId: str = "pmma", o2Pct: float = 21.0,
                       flowCms: float = 0.0,
                       gravity: str = "microgravity") -> dict:
    """Live decision cards: countermeasure scores from the fitted risk
    model + KNN evidence + C++ ignition pressure for provenance."""
    payload = tactics.decision_cards(materialId, o2Pct, flowCms, gravity)
    # unresolved ids (butane, …) fall back inside risk_index — chamber
    # fields must quote the material the cards were actually built on
    resolved = payload["material"]["materialId"]
    return {
        "engine": "c++",
        "chamber": {
            "materialId": resolved,
            "requestedMaterialId": materialId,
            "o2Pct": o2Pct,
            "flowCms": flowCms,
            "ignitionPressure": round(eb.ignition_pressure(resolved, o2Pct), 4),
        },
        **payload,
    }


@app.websocket("/ws/chamber")
async def chamber_ws(ws: WebSocket) -> None:
    """Stream a live chamber run at ~30 Hz until the run finishes or 60 s cap."""
    await ws.accept()
    try:
        req = ChamberReq(**json.loads(await ws.receive_text()))
        ch = eb.make_chamber(req.investigationId, req.o2Pct, req.flowCms,
                             req.seed, req.pressureKpa)
        dt = 1.0 / 30.0
        deadline = time.monotonic() + 60
        while not ch.finished() and time.monotonic() < deadline:
            # the pure-Python fallback is CPU-bound — keep the event loop free
            await asyncio.to_thread(ch.step, dt)
            events = ch.drain_events()
            payload = json.loads(ch.state_json())
            if events:
                payload["events"] = events
            await ws.send_text(json.dumps(payload))
            await asyncio.sleep(dt)
        await ws.send_text(json.dumps({"done": True, "state": json.loads(ch.state_json())}))
    except WebSocketDisconnect:
        return
    except Exception as exc:  # surface config errors to the client
        try:
            await ws.send_text(json.dumps({"error": str(exc)}))
        finally:
            await ws.close()
