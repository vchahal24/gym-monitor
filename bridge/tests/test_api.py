import pytest
from fastapi.testclient import TestClient

from conftest import LE, LP, gt1
from server import create_app


@pytest.fixture
def client(bridge):
    with TestClient(create_app(bridge, ["http://localhost:5173"])) as c:
        yield c


def test_health_and_config(client, bridge):
    bridge.set_coordinator(True, "/dev/ttyUSB0", "0013A200FF", 15)
    h = client.get("/api/health").json()
    assert h["coordinatorConnected"] and h["port"] == "/dev/ttyUSB0" and h["pan"] == "0x47594D31"
    assert h["version"] and "uptimeSeconds" in h and h["motion"]["restingTimeoutSeconds"] == 3.0
    assert client.get("/api/config").json() == {"restingTimeoutSeconds": 3.0, "restingDelaySeconds": 0.4,
                                                "thresholdG": 0.1, "offlineAfterSeconds": 16, "source": "motion.h"}


def test_machines_are_contract_shaped(client, bridge):
    ms = client.get("/api/machines").json()
    assert [m["id"] for m in ms] == ["LE01", "LP01"]
    assert ms[0]["waiting"] and not ms[0]["online"] and ms[0]["status"] == "WAITING"
    bridge.handle(gt1(LP, "00000001", 1, "ACTIVE", 250), "0013A200AB")
    lp = client.get("/api/machines/LP01").json()
    for key in ("id", "name", "zoneId", "group", "kind", "state", "since", "sessionStartedAt", "maintenance",
                "override", "online", "lastHeartbeat"):
        assert key in lp
    assert lp["kind"] == "leg-press" and lp["state"] == "ACTIVE" and lp["dynamicG"] == 0.25
    assert lp["xbeeAddress"] == "0013A200AB" and lp["prototype"] and not lp["waiting"]
    assert client.get("/api/machines/TM01").status_code == 404


def test_events_offline_and_recording(client, bridge, clock):
    bridge.handle(gt1(LE, "00000001", 1, "AVAILABLE"))
    clock.advance(30)
    bridge.handle(gt1(LE, "00000001", 2, "ACTIVE"))
    clock.advance(20)
    bridge.sweep()
    clock.advance(40)
    bridge.handle(gt1(LE, "00000001", 3, "RESTING"))
    events = client.get("/api/machines/LE01/events").json()
    assert [e["state"] for e in events] == ["AVAILABLE", "ACTIVE", "RESTING"]
    assert set(events[0]) == {"machineId", "state", "timestamp"}
    later = client.get("/api/machines/LE01/events", params={"from": events[1]["timestamp"]}).json()
    assert [e["state"] for e in later] == ["ACTIVE", "RESTING"]
    spans = client.get("/api/machines/LE01/offline").json()
    assert [s["reason"] for s in spans] == ["offline"]
    assert spans[0]["since"] == events[1]["timestamp"] and spans[0]["end"] == events[2]["timestamp"]
    # LP01 has never been heard from: all of its time is unrecorded and still open
    assert client.get("/api/machines/LP01/offline").json()[0]["reason"] == "not_recording"
    rec = client.get("/api/recording").json()
    assert rec["startedAt"] and rec["machines"][0] == {"machineId": "LE01", "hours": round(30 / 3600, 3),
                                                        "firstEventAt": events[0]["timestamp"]}


def test_cors(client):
    ok = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-origin" not in client.get("/api/health", headers={"Origin": "http://evil.test"}).headers


def test_cors_origins_from_flag_and_env(monkeypatch):
    from server import cors_origins
    monkeypatch.setenv("GYM_BRIDGE_CORS", "https://gym.example, https://b.example")
    assert cors_origins({"http": {"cors": ["http://localhost:5173"]}}, ["http://x:1"]) == [
        "http://localhost:5173", "http://x:1", "https://gym.example", "https://b.example"]


def test_websocket_pushes(client, bridge, clock):
    with client.websocket_connect("/ws") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot" and len(snap["machines"]) == 2 and snap["config"]["source"] == "motion.h"
        client.portal.call(lambda: bridge.handle(gt1(LE, "00000001", 1, "AVAILABLE")))
        assert ws.receive_json()["type"] == "online"
        msg = ws.receive_json()
        assert msg["type"] == "state" and msg["event"]["state"] == "AVAILABLE" and msg["machine"]["id"] == "LE01"
        clock.advance(5)
        client.portal.call(lambda: bridge.handle(gt1(LE, "00000001", 1, "AVAILABLE", 55)))
        hb = ws.receive_json()
        assert hb == {"type": "heartbeat", "machineId": "LE01", "dynamicG": 0.055,
                      "lastHeartbeat": bridge.tracker.nodes[LE].last_heartbeat, "revision": 1}
        # a second heartbeat within 1 s is not pushed, the next state change is
        clock.advance(0.5)
        client.portal.call(lambda: bridge.handle(gt1(LE, "00000001", 1, "AVAILABLE", 56)))
        client.portal.call(lambda: bridge.handle(gt1(LE, "00000001", 2, "ACTIVE", 300)))
        assert ws.receive_json()["type"] == "state"
        client.portal.call(lambda: bridge.set_coordinator(False, "/dev/ttyUSB0"))
        assert ws.receive_json() == {"type": "coordinator", "connected": False, "port": "/dev/ttyUSB0",
                                     "address": None, "channel": None}
