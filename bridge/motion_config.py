"""Reads the firmware's motion timing from hardware/include/motion.h."""
from dataclasses import dataclass, field
from pathlib import Path
import re

from hardware_link import HARDWARE, OFFLINE_AFTER

MOTION_H = HARDWARE / "include" / "motion.h"
# (pattern, divisor to get seconds or g, fallback)
FIELDS = {
    "thresholdG": (re.compile(r"\bthresholdG\s*=\s*([0-9]*\.?[0-9]+)f?\s*;"), 1, 0.10),
    "restingTimeoutSeconds": (re.compile(r"\brestTimeoutMs\s*=\s*(\d+)\s*;"), 1000, 3.0),
    # the resting delay is a literal in Motion::update(): State::Active && now - lastMotion >= 400
    "restingDelaySeconds": (re.compile(r"State::Active\s*&&\s*now\s*-\s*lastMotion\s*>=\s*(\d+)"), 1000, 0.4),
}


@dataclass
class MotionConfig:
    thresholdG: float
    restingTimeoutSeconds: float
    restingDelaySeconds: float
    source: str
    missing: list[str] = field(default_factory=list)
    offlineAfterSeconds: int = OFFLINE_AFTER

    def api(self):
        return {"restingTimeoutSeconds": self.restingTimeoutSeconds, "restingDelaySeconds": self.restingDelaySeconds,
                "thresholdG": self.thresholdG, "offlineAfterSeconds": self.offlineAfterSeconds, "source": self.source}


def read_motion(path=MOTION_H, log=print):
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as error:
        log(f"Motion config: cannot read {path} ({error}); using defaults")
        text = ""
    values, missing = {}, []
    for name, (pattern, divisor, fallback) in FIELDS.items():
        match = pattern.search(text)
        if match:
            values[name] = round(float(match.group(1)) / divisor, 6)
        else:
            values[name] = fallback
            missing.append(name)
            if text:
                log(f"Motion config: {name} not found in {path}; using default {fallback}")
    source = "motion.h" if not missing else "default"
    return MotionConfig(**values, source=source, missing=missing)
