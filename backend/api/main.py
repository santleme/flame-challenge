"""Freefall Foundry backend — serves the C++ physics core over HTTP + WebSocket.

Run (from repo root, venv active):
    uvicorn backend.api.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.services import engine_bridge as eb
from backend.services import rag, risk, tactical

app = FastAPI(title="Freefall Foundry Engine API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PreviewReq(BaseModel):
    investigationId: str
    o2Pct: float
    flowCms: float | None = None


class ChamberReq(BaseModel):
    investigationId: str
    o2Pct: float
    flowCms: float | None = None
    seed: int = 1
    o2Source: int = 0  # 0 ambient / 1 enriched (Apollo 1) / 2 chem-gen (Mir)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "engine": "c++", "module": "freefall_engine"}


@app.get("/api/materials")
def get_materials() -> dict:
    return {"materials": eb.materials(), "investigations": eb.investigation_map()}


@app.post("/api/chamber/preview")
def chamber_preview(req: PreviewReq) -> dict:
    return eb.preview(req.investigationId, req.o2Pct, req.flowCms)


# ---------- SI layer: retrieval, SQL-RAG, risk simulator ----------

class AskReq(BaseModel):
    q: str
    k: int = 6


class RiskReq(BaseModel):
    materialId: str = "pmma"
    o2Pct: float = 21.0
    flowCms: float = 0.0
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
def api_risk_get(materialId: str = "pmma", o2Pct: float = 21.0,
                 flowCms: float = 0.0, gravity: str = "microgravity") -> dict:
    return risk.risk_index(materialId, o2Pct, flowCms, gravity)


@app.get("/api/risk/curve")
def api_risk_curve(materialId: str = "pmma", flowCms: float = 0.0,
                   gravity: str = "microgravity",
                   o2Min: float = 8.0, o2Max: float = 40.0) -> dict:
    return risk.curve(materialId, flowCms, gravity, o2Min, o2Max)


@app.get("/api/risk/materials")
def api_risk_materials() -> dict:
    return {"materials": risk.materials()}


# ---------- Tactical copilot: module ranking + citation-anchored advice ----

class ModuleTelemetry(BaseModel):
    moduleId: str
    materialId: str = "pmma"
    materialName: str = ""
    o2Pct: float = 21.0
    flowCms: float = 0.0
    o2Source: int = 0  # 0 ambient / 1 enriched / 2 chemical-generator


class RankReq(BaseModel):
    modules: list[ModuleTelemetry]


class AdviseReq(BaseModel):
    module: ModuleTelemetry


@app.post("/api/risk/rank")
def api_risk_rank(req: RankReq) -> dict:
    """Rank all active shipyard modules by criticality + dominant factor."""
    return tactical.rank_modules([m.model_dump() for m in req.modules])


@app.post("/api/tactical/advise")
def api_tactical_advise(req: AdviseReq) -> dict:
    """Strict-JSON tactical advice anchored to psi_experiments records."""
    return tactical.advise(req.module.model_dump())


@app.websocket("/ws/chamber")
async def chamber_ws(ws: WebSocket) -> None:
    """Stream a live chamber run at ~30 Hz until the run finishes or 60 s cap."""
    await ws.accept()
    try:
        req = ChamberReq(**json.loads(await ws.receive_text()))
        ch = eb.make_chamber(req.investigationId, req.o2Pct, req.flowCms,
                             req.seed, req.o2Source)
        dt = 1.0 / 30.0
        deadline = time.monotonic() + 60
        while not ch.finished() and time.monotonic() < deadline:
            ch.step(dt)
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
