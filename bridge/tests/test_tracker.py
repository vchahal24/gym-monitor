from conftest import LE, LP, gt1
from hardware_link import PACKET, OFFLINE_AFTER


def kinds(updates):
    return [u.kind for u in updates]


def test_packet_regex_is_the_coordinators():
    import coordinator
    assert PACKET is coordinator.PACKET and OFFLINE_AFTER == 16
    assert PACKET.fullmatch(gt1(LE, "0a1b2c3d", 7, "RESTING", 123)).groups() == (
        LE.encode(), b"0a1b2c3d", b"7", b"RESTING", b"123")
    for bad in (b"GT1,24DCC3458A78,0a1b2c3d,1,ACTIVE,5", b"GT1,24dcc3458a78,0a1b2c3d,1,BUSY,5",
                b"GT2,24dcc3458a78,0a1b2c3d,1,ACTIVE,5", gt1(LE, "0a1b2c3d", 1, "ACTIVE") + b"\n"):
        assert not PACKET.fullmatch(bad)


def test_non_gt1_is_ignored(bridge):
    assert kinds(bridge.handle(b"hello")) == ["ignored"]
    assert bridge.tracker.nodes[LE].waiting


def test_waiting_then_state(bridge):
    le = bridge.tracker.nodes[LE]
    assert le.status() == "WAITING"
    assert kinds(bridge.handle(gt1(LE, "00000001", 1, "AVAILABLE"), "0013A200AA")) == ["online", "state"]
    assert le.status() == "AVAILABLE" and le.online and le.xbee == "0013A200AA"
    assert bridge.lines[-1].startswith("Machine 1    AVAILABLE     0.020 g dynamic   XBee 0013A200AA")


def test_heartbeat_is_not_a_state_event(bridge, clock):
    bridge.handle(gt1(LE, "00000001", 1, "AVAILABLE"))
    clock.advance(5)
    lines = len(bridge.lines)
    assert kinds(bridge.handle(gt1(LE, "00000001", 1, "AVAILABLE", 31))) == ["heartbeat"]
    assert len(bridge.lines) == lines  # heartbeats are silent, like coordinator.py
    assert len(bridge.store.raw_events("LE01")) == 1
    assert bridge.tracker.nodes[LE].dynamic_mg == 31
    assert bridge.store.node("LE01")["last_heartbeat"] == bridge.tracker.nodes[LE].last_heartbeat


def test_stale_revision_and_old_boot_are_dropped(bridge, clock):
    bridge.handle(gt1(LE, "00000001", 3, "ACTIVE"))
    assert kinds(bridge.handle(gt1(LE, "00000001", 2, "RESTING"))) == ["stale"]
    assert bridge.tracker.nodes[LE].reported == "ACTIVE"
    # reboot, new boot id, revision starts again
    clock.advance(1)
    updates = bridge.handle(gt1(LE, "00000002", 1, "AVAILABLE"))
    assert kinds(updates) == ["state"] and updates[0].rebooted and updates[0].rejoined
    # a late packet from the old boot never comes back, even with a higher revision
    assert kinds(bridge.handle(gt1(LE, "00000001", 9, "ACTIVE"))) == ["stale"]
    assert bridge.store.raw_events("LE01")[-1]["reason"] == "boot"


def test_reboot_in_the_same_state_records_a_new_event(bridge, clock):
    bridge.handle(gt1(LP, "00000001", 1, "AVAILABLE"))
    clock.advance(2)
    updates = bridge.handle(gt1(LP, "00000002", 1, "AVAILABLE"))
    assert updates[-1].kind == "state" and not updates[-1].changed
    assert len(bridge.store.raw_events("LP01")) == 2
    # the contract stream drops the repeat
    assert [e["state"] for e in bridge.store.state_events("LP01")] == ["AVAILABLE"]


def test_offline_after_16_s_then_recovery(bridge, clock):
    bridge.handle(gt1(LE, "00000001", 1, "AVAILABLE"))
    clock.advance(15.9)
    assert bridge.sweep() == []
    clock.advance(0.1)
    updates = bridge.sweep()
    assert kinds(updates) == ["offline"] and bridge.lines[-1].endswith("Machine 1    OFFLINE")
    le = bridge.tracker.nodes[LE]
    assert le.status() == "OFFLINE" and not le.online
    assert bridge.sweep() == []  # only once
    clock.advance(10)
    updates = bridge.handle(gt1(LE, "00000001", 2, "ACTIVE"))
    assert kinds(updates) == ["online", "state"] and updates[1].rejoined and updates[1].changed
    offline = bridge.store.intervals("LE01", "offline")
    assert len(offline) == 1 and offline[0][1] is not None
    # rejoining in the same state still records the current state
    clock.advance(20)
    bridge.sweep()
    clock.advance(1)
    updates = bridge.handle(gt1(LE, "00000001", 2, "ACTIVE"))
    assert kinds(updates) == ["online", "state"] and not updates[1].changed
    assert bridge.store.raw_events("LE01")[-1]["reason"] == "rejoin"


def test_sensor_error(bridge, clock):
    bridge.handle(gt1(LP, "00000001", 1, "ACTIVE", 300))
    clock.advance(1)
    updates = bridge.handle(gt1(LP, "00000001", 2, "SENSOR_ERROR", 0))
    lp = bridge.tracker.nodes[LP]
    assert updates[-1].kind == "state" and not updates[-1].changed
    assert lp.online and lp.sensor_error and lp.status() == "SENSOR_ERROR"
    assert lp.state == "ACTIVE"  # last machine state stays, SENSOR_ERROR is not a machine state
    m = bridge.machine(lp)
    assert m["online"] and m["sensorError"] and m["status"] == "SENSOR_ERROR"
    assert ["ACTIVE"] == [e["state"] for e in bridge.store.state_events("LP01")]
    clock.advance(4)
    bridge.handle(gt1(LP, "00000001", 3, "AVAILABLE"))
    assert not lp.sensor_error
    errors = bridge.store.intervals("LP01", "sensor_error")
    assert len(errors) == 1 and errors[0][1] is not None
    # the firmware resets to AVAILABLE, so real data can go ACTIVE -> AVAILABLE
    assert [e["state"] for e in bridge.store.state_events("LP01")] == ["ACTIVE", "AVAILABLE"]


def test_sessions_follow_states(bridge, clock):
    bridge.handle(gt1(LE, "00000001", 1, "AVAILABLE"))
    clock.advance(1)
    bridge.handle(gt1(LE, "00000001", 2, "ACTIVE"))
    start = bridge.tracker.nodes[LE].since
    clock.advance(1)
    bridge.handle(gt1(LE, "00000001", 3, "RESTING"))
    m = bridge.machine(bridge.tracker.nodes[LE])
    assert m["state"] == "RESTING" and m["sessionStartedAt"] == start
    clock.advance(2.6)
    bridge.handle(gt1(LE, "00000001", 4, "AVAILABLE"))
    assert bridge.machine(bridge.tracker.nodes[LE])["sessionStartedAt"] is None


def test_unknown_mac_is_logged_not_stored(bridge):
    assert kinds(bridge.handle(gt1("0123456789ab", "00000001", 1, "ACTIVE"))) == ["online", "state"]
    assert "0123456789ab" in bridge.lines[-1]
    assert [m["id"] for m in bridge.machines()] == ["LE01", "LP01"]
