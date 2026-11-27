"""SQLite record of every real sensor event, online/offline interval and heartbeat."""
from pathlib import Path
import sqlite3
import threading

from tracker import MACHINE_STATES

SCHEMA = """
create table if not exists events (id integer primary key, machine_id text not null, state text not null,
    at text not null, dynamic_mg integer, boot_id text, revision integer, xbee text, reason text);
create index if not exists events_machine_at on events (machine_id, at);
create table if not exists intervals (id integer primary key, machine_id text not null, kind text not null,
    start text not null, "end" text);
create index if not exists intervals_machine on intervals (machine_id, kind, start);
create table if not exists nodes (machine_id text primary key, mac text, last_heartbeat text, boot_id text,
    revision integer, state text, dynamic_mg integer, xbee text);
create table if not exists meta (key text primary key, value text);
"""


class Store:
    def __init__(self, path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.executescript(SCHEMA)

    def started(self, now):
        # recording starts with the first run on this database
        with self.lock, self.db:
            self.db.execute("insert or ignore into meta values ('recording_started', ?)", (now,))
            return self.db.execute("select value from meta where key = 'recording_started'").fetchone()[0]

    def close_open_intervals(self):
        # after a crash or Ctrl+C, open intervals end at that node's last heartbeat
        with self.lock, self.db:
            self.db.execute("""update intervals set "end" = coalesce((select last_heartbeat from nodes
                where nodes.machine_id = intervals.machine_id), start) where "end" is null""")

    def add_event(self, machine_id, state, at, dynamic_mg, boot_id, revision, xbee, reason):
        with self.lock, self.db:
            self.db.execute("insert into events (machine_id, state, at, dynamic_mg, boot_id, revision, xbee, reason) "
                            "values (?, ?, ?, ?, ?, ?, ?, ?)", (machine_id, state, at, dynamic_mg, boot_id, revision, xbee, reason))

    def open_interval(self, machine_id, kind, start):
        with self.lock, self.db:
            self.db.execute("insert into intervals (machine_id, kind, start) values (?, ?, ?)", (machine_id, kind, start))

    def close_interval(self, machine_id, kind, end):
        with self.lock, self.db:
            self.db.execute("""update intervals set "end" = ? where machine_id = ? and kind = ? and "end" is null""",
                            (end, machine_id, kind))

    def heartbeat(self, machine_id, mac, at, boot_id, revision, state, dynamic_mg, xbee):
        with self.lock, self.db:
            self.db.execute("insert or replace into nodes values (?, ?, ?, ?, ?, ?, ?, ?)",
                            (machine_id, mac, at, boot_id, revision, state, dynamic_mg, xbee))

    def node(self, machine_id):
        with self.lock:
            return self.db.execute("select * from nodes where machine_id = ?", (machine_id,)).fetchone()

    def raw_events(self, machine_id):
        with self.lock:
            return self.db.execute("select * from events where machine_id = ? order by at, id", (machine_id,)).fetchall()

    def last_machine_state(self, machine_id):
        # (state, since, session started) rebuilt from the log, so a restart keeps the last known state
        rows = self.state_events(machine_id)
        if not rows:
            return None, None, None
        state, since = rows[-1]["state"], rows[-1]["timestamp"]
        started = None
        if state != "AVAILABLE":
            i = len(rows) - 1
            while i > 0 and rows[i - 1]["state"] != "AVAILABLE":
                i -= 1
            started = rows[i]["timestamp"]
        return state, since, started

    def state_events(self, machine_id, start=None, end=None, prior=False):
        # contract StateEvent[]: machine states only, repeats from rejoins and reboots dropped
        with self.lock:
            rows = self.db.execute("select state, at from events where machine_id = ? and state in (?, ?, ?) "
                                   "and (? is null or at <= ?) order by at, id", (machine_id, *MACHINE_STATES, end, end)).fetchall()
        events = []
        for row in rows:
            if not events or events[-1]["state"] != row["state"]:
                events.append({"machineId": machine_id, "state": row["state"], "timestamp": row["at"]})
        if start is None:
            return events
        first = next((i for i, e in enumerate(events) if e["timestamp"] >= start), len(events))
        return events[max(0, first - 1) if prior else first:]

    def intervals(self, machine_id, kind, start=None, end=None):
        with self.lock:
            rows = self.db.execute("""select start, "end" from intervals where machine_id = ? and kind = ?
                and (? is null or "end" is null or "end" >= ?) and (? is null or start <= ?) order by start""",
                                   (machine_id, kind, start, start, end, end)).fetchall()
        return [(r["start"], r["end"]) for r in rows]
