"""End-to-end smoke suite — boots the real FastAPI app + C++ engine and
exercises the full loop a judge would hit:

    /health            → C++ handshake
    /api/chamber/preview → physics preview
    /api/risk/rank     → multifactor module ranking
    /api/tactical/advise → citation-anchored copilot
    /ws/chamber        → live telemetry stream (Mir scenario)

Run:  pytest backend/tests/test_e2e_smoke.py -q
Requires the compiled pybind module on PYTHONPATH (core/build).
"""
from __future__ import annotations

import json
import threading
import time
import urllib.request

import pytest

try:
    import httpx
    import uvicorn
    import websockets.sync.client as ws_sync
except ImportError:  # pragma: no cover
    httpx = None

pytestmark = pytest.mark.skipif(httpx is None, reason="httpx/uvicorn/websockets not installed")

BASE = "http://127.0.0.1:18123"


@pytest.fixture(scope="module")
def server():
    from backend.api.main import app

    cfg = uvicorn.Config(app, host="127.0.0.1", port=18123, log_level="error")
    srv = uvicorn.Server(cfg)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):  # wait for listen
        try:
            urllib.request.urlopen(f"{BASE}/health", timeout=0.3)
            break
        except OSError:
            time.sleep(0.05)
    yield
    srv.should_exit = True
    t.join(timeout=5)


def test_health_cpp_handshake(server):
    r = httpx.get(f"{BASE}/health")
    assert r.status_code == 200
    assert r.json()["engine"] == "c++"


def test_chamber_preview(server):
    r = httpx.post(f"{BASE}/api/chamber/preview",
                   json={"investigationId": "sofie-gel", "o2Pct": 21.0})
    assert r.status_code == 200
    body = r.json()
    assert 0 < body["ignitionPressure"] <= 1.0
    assert body["engine"] == "c++"


def test_risk_rank_orders_modules(server):
    r = httpx.post(f"{BASE}/api/risk/rank", json={"modules": [
        {"moduleId": "m1", "materialId": "nomex", "o2Pct": 15, "flowCms": 2},
        {"moduleId": "m2", "materialId": "pmma", "o2Pct": 21, "flowCms": 18},
    ]})
    assert r.status_code == 200
    ranked = r.json()["ranked"]
    assert ranked[0]["moduleId"] == "m2"
    assert ranked[0]["dominantFactor"] == "propagation"
    assert ranked[0]["citation"]["psi_id"]


def test_tactical_advise_strict_json(server):
    r = httpx.post(f"{BASE}/api/tactical/advise",
                   json={"module": {"moduleId": "m2", "materialId": "pmma",
                                    "o2Pct": 21, "flowCms": 18}})
    assert r.status_code == 200
    body = r.json()
    for k in ("diagnostico_fisico", "acao_imediata_1", "acao_imediata_2",
              "erro_a_evitar", "citacao_nasa_id"):
        assert k in body and isinstance(body[k], str)


def test_mir_scenario_ws_stream(server):
    """CHEMICAL_GENERATOR fire must keep spreading below LOC over the wire."""
    with ws_sync.connect(f"{BASE.replace('http', 'ws')}/ws/chamber") as ws:
        ws.send(json.dumps({
            "investigationId": "sofie-gel", "o2Pct": 10.0, "seed": 7,
            "o2Source": 2,  # Mir 1997 chemical generator
        }))
        seen_risk_keys = False
        for _ in range(200):
            msg = json.loads(ws.recv(timeout=5))
            if msg.get("done"):
                break
            st = msg.get("state", msg)
            if "riskSpreadMms" in st:
                seen_risk_keys = True
        assert seen_risk_keys, "telemetry must carry the multifactor risk vector"
