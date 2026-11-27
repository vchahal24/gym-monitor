# /// script
# requires-python = ">=3.11"
# dependencies = ["digi-xbee==1.5.0", "pyserial==3.5", "fastapi>=0.115", "uvicorn>=0.30", "websockets>=13"]
# ///
"""GymTracker bridge: the coordinator's live terminal plus a recording HTTP/WebSocket API for the website."""
import argparse
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
import os
from pathlib import Path
import threading
import time
import tomllib

from hardware_link import PAN
from motion_config import read_motion
from sources import fake_reader, start_thread, xbee_reader
from store import Store
from tracker import Tracker, iso

VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
CONFIG = HERE / "machines.toml"
DEFAULT_DB = HERE / "data" / "gym.db"
HEARTBEAT_PUSH_EVERY = 1.0  # at most one heartbeat message per machine per second


def event(text):
    print(f"{datetime.now():%H:%M:%S}  {text}", flush=True)


def load_config(path=CONFIG):
    with open(path, "rb") as file:
        return tomllib.load(file)


def parse_time(value):
    if value is None:
        return None
    try:
        return iso(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def seconds(a, b):
    return (datetime.fromisoformat(b.replace("Z", "+00:00")) - datetime.fromisoformat(a.replace("Z", "+00:00"))).total_seconds()


class Bridge:
    def __init__(self, machines, store, motion, wall=time.time, mono=time.monotonic, log=event, check_links=False):
        self.meta, self.store, self.motion = machines, store, motion
        self.wall, self.mono, self.log, self.check_links = wall, mono, log, check_links
        self.tracker = Tracker(machines)
        self.started_mono = mono()
        self.started = iso(wall())
        self.recording_started = store.started(self.started)
        store.close_open_intervals()
        for node in self.tracker.nodes.values():
            node.state, node.since, node.session_started = store.last_machine_state(node.id)
            row = store.node(node.id)
            if row:
                node.last_heartbeat, node.xbee = row["last_heartbeat"], row["xbee"]
        self.coordinator = {"connected": False, "port": None, "address": None, "channel": None}
        self.clients = set()
        self.loop = None
        self.pushed_heartbeat = {}
        self.errors_open = set()

    # ---------------- PACKETS ----------------

    def handle(self, data, xbee=None, remote=None):
        updates = self.tracker.packet(data, xbee, self.wall(), self.mono(), remote)
        for update in updates:
            self.apply(update)
        return updates

    def sweep(self):
        updates = self.tracker.sweep(self.wall(), self.mono())
        for update in updates:
            self.apply(update)
        return updates

    def apply(self, u):
        node = u.node
        if u.kind in ("ignored", "stale"):
            return
        if u.kind == "state":
            self.log(f"{node.label:<12} {node.reported:<13} {node.dynamic_mg/1000:.3f} g dynamic   XBee {u.xbee or node.xbee}")
            if self.check_links and u.rejoined and u.remote is not None and self.loop:
                self.loop.run_in_executor(None, self.query_radio, node, u.remote)
        elif u.kind == "offline":
            self.log(f"{node.label:<12} OFFLINE")
        if node.id is None:
            return
        if u.kind == "online":
            self.store.close_interval(node.id, "offline", u.at)
            self.store.open_interval(node.id, "online", u.at)
            self.push({"type": "online", "machineId": node.id, "online": True, "machine": self.machine(node)})
        elif u.kind == "offline":
            for kind in ("online", "sensor_error"):
                self.store.close_interval(node.id, kind, node.last_heartbeat)
            self.errors_open.discard(node.id)
            self.store.open_interval(node.id, "offline", node.last_heartbeat)
            self.push({"type": "online", "machineId": node.id, "online": False, "machine": self.machine(node)})
        elif u.kind == "state":
            reason = "boot" if u.rebooted or u.previous is None else "rejoin" if u.rejoined else "change"
            self.store.add_event(node.id, node.reported, u.at, node.dynamic_mg, node.boot, node.revision, node.xbee, reason)
            if node.reported == "SENSOR_ERROR" and node.id not in self.errors_open:
                self.errors_open.add(node.id)
                self.store.open_interval(node.id, "sensor_error", u.at)
            elif node.reported != "SENSOR_ERROR" and node.id in self.errors_open:
                self.errors_open.discard(node.id)
                self.store.close_interval(node.id, "sensor_error", u.at)
            machine = self.machine(node)
            if u.changed:
                event = {"machineId": node.id, "state": node.state, "timestamp": u.at}
                self.push({"type": "state", "event": event, "machine": machine})
            else:
                self.push({"type": "machine", "machine": machine})
            self.pushed_heartbeat[node.id] = self.mono()
        if u.kind in ("state", "heartbeat"):
            self.store.heartbeat(node.id, node.mac, node.last_heartbeat, node.boot, node.revision, node.reported,
                                 node.dynamic_mg, node.xbee)
        if u.kind == "heartbeat" and self.mono() - self.pushed_heartbeat.get(node.id, -1e9) >= HEARTBEAT_PUSH_EVERY:
            self.pushed_heartbeat[node.id] = self.mono()
            self.push({"type": "heartbeat", "machineId": node.id, "dynamicG": node.dynamic_mg / 1000,
                       "lastHeartbeat": node.last_heartbeat, "revision": node.revision})

    def query_radio(self, node, remote):
        from digi.xbee.exception import XBeeException
        try:
            version = remote.get_parameter("VR").hex().upper()
            self.log(f"{node.label:<12} Radio answered coordinator query (firmware {version})")
        except XBeeException as error:
            self.log(f"{node.label:<12} Coordinator query failed ({error})")

    def set_coordinator(self, connected, port, address=None, channel=None):
        if self.coordinator["connected"] == connected and self.coordinator["port"] == port:
            return
        self.coordinator = {"connected": connected, "port": port, "address": address, "channel": channel}
        self.push({"type": "coordinator", **self.coordinator})

    def shutdown(self):
        self.store.close_open_intervals()

    # ---------------- WEBSOCKET ----------------

    def push(self, msg):
        for queue in list(self.clients):
            if self.loop is None:
                self.offer(queue, msg)
            else:
                try:
                    running = asyncio.get_running_loop() is self.loop
                except RuntimeError:
                    running = False
                if running:
                    self.offer(queue, msg)
                else:
                    self.loop.call_soon_threadsafe(self.offer, queue, msg)

    @staticmethod
    def offer(queue, msg):
        try:
            queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass

    # ---------------- VIEWS ----------------

    def machine(self, node):
        m = self.meta[node.mac]
        return {
            "id": node.id, "name": m.get("name", node.id), "zoneId": m.get("zone", m.get("group", "")),
            "group": m.get("group", ""), "kind": m.get("kind", ""),
            "state": node.state or "AVAILABLE", "since": node.since or self.started,
            "sessionStartedAt": node.session_started if node.state in ("ACTIVE", "RESTING") else None,
            "maintenance": None, "override": None,
            "online": node.online, "lastHeartbeat": node.last_heartbeat, "prototype": True,
            "dynamicG": node.dynamic_mg / 1000 if node.boot else None, "sensorError": node.sensor_error,
            "waiting": node.waiting, "xbeeAddress": node.xbee, "bootId": node.boot,
            "revision": node.revision if node.boot else None, "onlineSince": node.online_since if node.online else None,
            "status": node.status(), "label": node.label, "mac": node.mac,
        }

    def machines(self):
        return [self.machine(n) for n in self.tracker.nodes.values() if n.id]

    def offline_spans(self, machine_id, start=None, end=None):
        # every span without good data since recording started: offline, sensor_error or not_recording
        now = iso(self.wall())
        lo = max(start or self.recording_started, self.recording_started)
        hi = min(end or now, now)
        if hi <= lo:
            return []
        online = [(s, e or now) for s, e in self.store.intervals(machine_id, "online", lo, hi)]
        offline = self.store.intervals(machine_id, "offline", lo, hi)
        spans, cursor = [], lo
        for s, e in online:
            if s > cursor:
                spans.append([cursor, min(s, hi)])
            cursor = max(cursor, e)
        node = self.tracker.by_id(machine_id)
        if cursor < hi:
            spans.append([cursor, None if end is None and not (node and node.online) else hi])

        def reason(a, b):
            b = b or now
            return "offline" if any(s < b and (e is None or e > a) for s, e in offline) else "not_recording"
        out = [{"since": a, "end": b, "reason": reason(a, b)} for a, b in spans]
        for s, e in self.store.intervals(machine_id, "sensor_error", lo, hi):
            out.append({"since": max(s, lo), "end": e, "reason": "sensor_error"})
        return sorted(out, key=lambda x: x["since"])

    def recording(self):
        now = iso(self.wall())
        machines = []
        for node in self.tracker.nodes.values():
            if not node.id:
                continue
            good = sum(seconds(s, e or now) for s, e in self.store.intervals(node.id, "online"))
            bad = sum(seconds(s, e or now) for s, e in self.store.intervals(node.id, "sensor_error"))
            events = self.store.state_events(node.id)
            machines.append({"machineId": node.id, "hours": round(max(0, good - bad) / 3600, 3),
                             "firstEventAt": events[0]["timestamp"] if events else None})
        return {"startedAt": self.recording_started, "now": now, "machines": machines}

    def health(self):
        return {
            "version": VERSION, "coordinatorConnected": self.coordinator["connected"], "port": self.coordinator["port"],
            "coordinator": self.coordinator, "pan": f"0x{PAN:X}", "uptimeSeconds": round(self.mono() - self.started_mono, 1),
            "startedAt": self.started, "motion": {**self.motion.api(), "missing": self.motion.missing},
        }


def create_app(bridge, cors, sources=None):
    from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
    from fastapi.middleware.cors import CORSMiddleware

    @asynccontextmanager
    async def lifespan(app):
        bridge.loop = asyncio.get_running_loop()
        stop = threading.Event()

        async def sweeper():
            while True:
                await asyncio.sleep(0.5)
                bridge.sweep()
        task = asyncio.create_task(sweeper())
        if sources:
            sources(bridge, stop)
        try:
            yield
        finally:
            stop.set()
            task.cancel()
            bridge.shutdown()

    app = FastAPI(title="GymTracker bridge", version=VERSION, lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=cors, allow_methods=["GET"], allow_headers=["*"])

    def known(machine_id):
        if not bridge.tracker.by_id(machine_id):
            raise HTTPException(404, f"Machine {machine_id} is not a real sensor node")

    @app.get("/api/health")
    def health():
        return bridge.health()

    @app.get("/api/config")
    def config():
        return bridge.motion.api()

    @app.get("/api/machines")
    def machines():
        return bridge.machines()

    @app.get("/api/machines/{machine_id}")
    def machine(machine_id: str):
        known(machine_id)
        return bridge.machine(bridge.tracker.by_id(machine_id))

    @app.get("/api/machines/{machine_id}/events")
    def events(machine_id: str, start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
               prior: bool = False):
        known(machine_id)
        return bridge.store.state_events(machine_id, parse_time(start), parse_time(end), prior)

    @app.get("/api/machines/{machine_id}/offline")
    def offline(machine_id: str, start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to")):
        known(machine_id)
        return bridge.offline_spans(machine_id, parse_time(start), parse_time(end))

    @app.get("/api/recording")
    def recording():
        return bridge.recording()

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        queue = asyncio.Queue(maxsize=500)
        bridge.clients.add(queue)
        try:
            await websocket.send_json({"type": "snapshot", "machines": bridge.machines(), "config": bridge.motion.api(),
                                       "coordinator": bridge.coordinator, "recording": bridge.recording()})
            while True:
                await websocket.send_json(await queue.get())
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            bridge.clients.discard(queue)

    return app


def cors_origins(config, extra):
    origins = list(config.get("http", {}).get("cors", ["http://localhost:5173"]))
    for value in [*(extra or []), os.environ.get("GYM_BRIDGE_CORS", "")]:
        origins += [o.strip() for o in value.split(",") if o.strip()]
    return list(dict.fromkeys(origins))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", help="USB coordinator port, autodetected when omitted")
    parser.add_argument("--setup", action="store_true", help="set the attached radio as the GYM1 coordinator and save settings")
    parser.add_argument("--check-links", action="store_true", help="query each radio over the air when it joins or reconnects")
    parser.add_argument("--http-port", type=int, default=8000, help="HTTP/WebSocket port (default 8000)")
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind address (default 127.0.0.1, 0.0.0.0 for the LAN)")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite database (default bridge/data/gym.db)")
    parser.add_argument("--cors", action="append", help="extra allowed website origin(s), comma separated")
    parser.add_argument("--fake", action="store_true", help="generate GT1 packets for both nodes instead of using the radio")
    args = parser.parse_args()

    import uvicorn

    config = load_config()
    machines = config["machines"]
    motion = read_motion(log=event)
    bridge = Bridge(machines, Store(args.db), motion, check_links=args.check_links)

    def sources(bridge, stop):
        def deliver(data, xbee, remote):
            bridge.loop.call_soon_threadsafe(bridge.handle, data, xbee, remote)

        def status(connected, port, address=None, channel=None):
            bridge.loop.call_soon_threadsafe(bridge.set_coordinator, connected, port, address, channel)
        if args.fake:
            start_thread(fake_reader, deliver, status, motion, stop)
        else:
            start_thread(xbee_reader, deliver, status, args.port, args.setup, stop, event, lambda t: print(t, flush=True))

    print("GymTracker   |   Live Zigbee activity   |   Ctrl+C to close", flush=True)
    print(f"Motion from {motion.source}: {motion.thresholdG:.2f} g threshold, RESTING after {motion.restingDelaySeconds:g} s, "
          f"AVAILABLE {motion.restingTimeoutSeconds:g} s after the last movement", flush=True)
    print(f"Website API on http://{args.host}:{args.http_port}  ·  recording to {args.db}"
          + ("  ·  FAKE packets" if args.fake else ""), flush=True)
    for node in bridge.tracker.nodes.values():
        event(f"{node.label:<12} WAITING")
    app = create_app(bridge, cors_origins(config, args.cors), sources)
    uvicorn.run(app, host=args.host, port=args.http_port, log_level="warning", access_log=False)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
