from motion_config import MOTION_H, read_motion

HEADER = """
class Motion {
public:
    static constexpr float thresholdG = 0.10f;
    static constexpr uint32_t restTimeoutMs = 300000;
    State update(Acceleration sample, uint32_t now) {
        if (state != State::Available && now - lastMotion >= restTimeoutMs) state = State::Available;
        else if (state == State::Active && now - lastMotion >= 400) state = State::Resting;
    }
};
"""


def test_reads_the_real_motion_h():
    lines = []
    cfg = read_motion(MOTION_H, lines.append)
    assert cfg.source == "motion.h" and not cfg.missing and not lines
    assert cfg.thresholdG == 0.1 and cfg.restingDelaySeconds == 0.4
    assert cfg.restingTimeoutSeconds == 3.0
    assert cfg.api() == {"restingTimeoutSeconds": 3.0, "restingDelaySeconds": 0.4, "thresholdG": 0.1,
                         "offlineAfterSeconds": 16, "source": "motion.h"}


def test_follows_a_five_minute_firmware(tmp_path):
    path = tmp_path / "motion.h"
    path.write_text(HEADER)
    cfg = read_motion(path, lambda _: None)
    assert cfg.restingTimeoutSeconds == 300 and cfg.source == "motion.h"


def test_missing_value_falls_back_with_a_log_line(tmp_path):
    path = tmp_path / "motion.h"
    path.write_text(HEADER.replace("restTimeoutMs = 300000", "restTimeout = 300000"))
    lines = []
    cfg = read_motion(path, lines.append)
    assert cfg.restingTimeoutSeconds == 3.0 and cfg.source == "default" and cfg.missing == ["restingTimeoutSeconds"]
    assert len(lines) == 1 and "restingTimeoutSeconds not found" in lines[0]


def test_missing_file_falls_back(tmp_path):
    lines = []
    cfg = read_motion(tmp_path / "nope.h", lines.append)
    assert cfg.source == "default" and len(cfg.missing) == 3 and "using defaults" in lines[0]
