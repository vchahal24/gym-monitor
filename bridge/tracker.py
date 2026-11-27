"""Node tracking: coordinator.py's stale-packet rules plus online, offline and heartbeats."""
from dataclasses import dataclass
from datetime import datetime, timezone

from hardware_link import OFFLINE_AFTER, PACKET

MACHINE_STATES = ("AVAILABLE", "ACTIVE", "RESTING")


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class Node:
    mac: str
    id: str | None
    label: str
    boot: str | None = None
    revision: int = 0
    reported: str | None = None  # last STATE field, may be SENSOR_ERROR
    received: float | None = None  # monotonic time of the last accepted packet
    online: bool = False
    dynamic_mg: int = 0
    xbee: str | None = None
    last_heartbeat: str | None = None
    online_since: str | None = None
    state: str | None = None  # last machine state (AVAILABLE, ACTIVE or RESTING)
    since: str | None = None
    session_started: str | None = None

    @property
    def waiting(self):
        return self.boot is None

    @property
    def sensor_error(self):
        return self.online and self.reported == "SENSOR_ERROR"

    def status(self):
        if self.waiting:
            return "WAITING"
        return self.reported if self.online else "OFFLINE"


@dataclass
class Update:
    kind: str  # online, offline, state, heartbeat, stale, ignored
    node: Node | None
    at: str = ""
    rejoined: bool = False
    rebooted: bool = False
    changed: bool = False  # the machine state changed (a new StateEvent)
    previous: str | None = None
    xbee: str | None = None
    remote: object = None


class Tracker:
    def __init__(self, machines):
        self.nodes = {mac: Node(mac, m["id"], m.get("label", m["id"])) for mac, m in machines.items()}
        self.old_boots = {}

    def by_id(self, machine_id):
        return next((n for n in self.nodes.values() if n.id == machine_id), None)

    def packet(self, data, xbee, wall, mono, remote=None):
        match = PACKET.fullmatch(bytes(data))
        if not match:
            return [Update("ignored", None)]
        key, boot, seq, reported, mg = (v.decode("ascii") for v in match.groups())
        revision = int(seq)
        node = self.nodes.get(key) or self.nodes.setdefault(key, Node(key, None, key))
        retired = self.old_boots.setdefault(key, set())
        seen = node.boot is not None
        if boot in retired or (seen and node.boot == boot and revision < node.revision):
            return [Update("stale", node)]
        rebooted = seen and boot != node.boot
        if rebooted:
            retired.add(node.boot)
        rejoined = not seen or not node.online or rebooted
        changed = rejoined or node.reported != reported
        now = iso(wall)
        updates = []
        if not node.online:
            node.online, node.online_since = True, now
            updates.append(Update("online", node, now))
        previous = node.reported
        node.boot, node.revision, node.received, node.reported = boot, revision, mono, reported
        node.dynamic_mg, node.last_heartbeat, node.xbee = int(mg), now, xbee or node.xbee
        if not changed:
            return updates + [Update("heartbeat", node, now)]
        effective = reported in MACHINE_STATES and reported != node.state
        if effective:
            self.apply(node, reported, now)
        return updates + [Update("state", node, now, rejoined, rebooted, effective, previous, xbee, remote)]

    def sweep(self, wall, mono):
        updates = []
        for node in self.nodes.values():
            if node.online and mono - node.received >= OFFLINE_AFTER:
                node.online = False
                updates.append(Update("offline", node, iso(wall)))
        return updates

    @staticmethod
    def apply(node, state, at):
        if state == "ACTIVE" and node.state in (None, "AVAILABLE"):
            node.session_started = at
        elif state == "AVAILABLE":
            node.session_started = None
        node.state, node.since = state, at
