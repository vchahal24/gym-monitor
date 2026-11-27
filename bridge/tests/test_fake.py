from conftest import LE, LP
from motion_config import MotionConfig
from sources import fake_nodes


def test_fake_script_covers_every_case(bridge, clock):
    nodes = fake_nodes(MotionConfig(0.1, 3.0, 0.4, "motion.h"), seed=1)
    seen = []
    t, step = 0.0, 0.02
    while t < 150:
        for node in nodes:
            for data, xbee in node.step(t):
                seen += [(node.mac, u.kind, u.node.reported if u.node else None, u.rebooted) for u in bridge.handle(data, xbee)]
        seen += [(u.node.mac, u.kind, None, False) for u in bridge.sweep()]
        t += step
        clock.advance(step)
    kinds = {(mac, kind) for mac, kind, _, _ in seen}
    assert (LE, "offline") in kinds and (LE, "online") in kinds
    assert (LP, "stale") in kinds and any(mac == LP and rebooted for mac, _, _, rebooted in seen)
    assert (LP, "SENSOR_ERROR") in {(mac, state) for mac, kind, state, _ in seen if kind == "state"}
    assert (LE, "heartbeat") in kinds
    states = [e["state"] for e in bridge.store.state_events("LE01")]
    assert {"ACTIVE", "RESTING", "AVAILABLE"} <= set(states)
    # LE01 went quiet for 20 s and the bridge saw it as offline in between
    assert [s["reason"] for s in bridge.offline_spans("LE01")] == ["offline"]
