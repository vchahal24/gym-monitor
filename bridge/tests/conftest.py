import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from motion_config import MotionConfig
from server import Bridge, load_config
from store import Store

LE, LP = "24dcc3458a78", "ac1518ebf918"


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def wall(self):
        return self.t

    def mono(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


def gt1(mac, boot, revision, state, mg=20):
    return f"GT1,{mac},{boot},{revision},{state},{mg}".encode()


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def motion():
    return MotionConfig(thresholdG=0.1, restingTimeoutSeconds=3.0, restingDelaySeconds=0.4, source="motion.h")


@pytest.fixture
def bridge(clock, motion):
    lines = []
    b = Bridge(load_config()["machines"], Store(":memory:"), motion, wall=clock.wall, mono=clock.mono, log=lines.append)
    b.lines = lines
    return b
