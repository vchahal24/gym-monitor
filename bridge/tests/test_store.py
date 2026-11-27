from motion_config import MotionConfig
from server import Bridge, load_config
from store import Store
from conftest import LE, Clock, gt1


def test_round_trip_survives_a_restart(tmp_path):
    db = tmp_path / "gym.db"
    clock = Clock()
    motion = MotionConfig(0.1, 3.0, 0.4, "motion.h")
    machines = load_config()["machines"]
    b = Bridge(machines, Store(db), motion, wall=clock.wall, mono=clock.mono, log=lambda _: None)
    b.handle(gt1(LE, "0000000a", 1, "AVAILABLE"), "0013A200AA")
    clock.advance(10)
    b.handle(gt1(LE, "0000000a", 2, "ACTIVE", 412), "0013A200AA")
    clock.advance(1)
    b.handle(gt1(LE, "0000000a", 3, "RESTING"), "0013A200AA")
    started = b.recording_started
    b.shutdown()
    row = b.store.raw_events("LE01")[1]
    assert (row["state"], row["dynamic_mg"], row["boot_id"], row["revision"], row["xbee"]) == (
        "ACTIVE", 412, "0000000a", 2, "0013A200AA")
    assert row["at"].endswith("Z") and "T" in row["at"]
    clock.advance(100)
    again = Bridge(machines, Store(db), motion, wall=clock.wall, mono=clock.mono, log=lambda _: None)
    assert again.recording_started == started
    le = again.tracker.nodes[LE]
    assert le.waiting and le.state == "RESTING" and le.session_started == row["at"]
    assert again.store.intervals("LE01", "online") == [(b.store.raw_events("LE01")[0]["at"], le.last_heartbeat)]
    assert [e["state"] for e in again.store.state_events("LE01")] == ["AVAILABLE", "ACTIVE", "RESTING"]
    assert again.recording()["machines"][0]["hours"] == round(11 / 3600, 3)


def test_event_ranges(bridge, clock):
    times = []
    for i, state in enumerate(["AVAILABLE", "ACTIVE", "RESTING", "AVAILABLE"]):
        bridge.handle(gt1(LE, "00000001", i + 1, state))
        times.append(bridge.tracker.nodes[LE].since)
        clock.advance(60)
    assert len(bridge.store.state_events("LE01", times[1], times[2])) == 2
    assert [e["state"] for e in bridge.store.state_events("LE01", times[2], None, prior=True)] == [
        "ACTIVE", "RESTING", "AVAILABLE"]
