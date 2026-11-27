"""Packet sources for the bridge: the USB XBee coordinator, or --fake nodes."""
import random
import threading
import time

import serial

from hardware_link import PAN, choose_port, configure, enable_api, port_present


def xbee_reader(deliver, status, port_arg, setup, stop, log, show):
    """Reads the coordinator on its own thread and reconnects when the adapter comes back."""
    from digi.xbee.devices import ZigBeeDevice
    from digi.xbee.exception import TimeoutException, XBeeException

    def run(port):
        if setup:
            enable_api(port)
        device = ZigBeeDevice(port, 9600)
        try:
            device.open()
            if setup:
                configure(device)
            if (int.from_bytes(device.get_parameter("CE"), "big") != 1 or
                    int.from_bytes(device.get_parameter("OP"), "big") != PAN):
                raise ValueError("Run with --setup to form the GYM1 network on this radio.")
            channel = int.from_bytes(device.get_parameter("CH"), "big")
            address = str(device.get_64bit_addr())
            show(f"Coordinator {address} on {port}, PAN {PAN:016X}, channel {channel}")
            status(True, port, address, channel)
            last_port_check = time.monotonic()
            while not stop.is_set():
                try:
                    msg = device.read_data(timeout=1)
                except TimeoutException:
                    msg = None
                now = time.monotonic()
                if not msg and now-last_port_check >= 4:
                    last_port_check = now
                    if not port_present(device.serial_port.port):
                        raise serial.SerialException("Coordinator USB adapter disconnected.")
                if msg:
                    remote = msg.remote_device
                    deliver(bytes(msg.data), str(remote.get_64bit_addr()), remote)
        finally:
            device.close()

    last_error = None
    while not stop.is_set():
        port = port_arg
        if not port:
            try:
                port = choose_port()
            except ValueError as error:
                if str(error) != last_error:
                    last_error = str(error)
                    log(f"Coordinator: {error} Waiting for the adapter.")
                status(False, None)
                stop.wait(2)
                continue
        try:
            run(port)
        except (XBeeException, serial.SerialException, ValueError, OSError) as error:
            status(False, port)
            if stop.is_set():
                return
            if isinstance(error, ValueError) or port_present(port):
                if str(error) != last_error:
                    last_error = str(error)
                    log(f"Coordinator: {error} Retrying every 5 s.")
                stop.wait(5)
                continue
            log(f"Coordinator disconnected. Waiting for {port}.")
            while not stop.is_set() and not port_present(port):
                time.sleep(1)
            time.sleep(1)


# ---------------- FAKE NODES ----------------

CYCLE = 150  # seconds, then the script repeats
# per MAC: fake XBee address, movement bursts (start, end) in s, and special events
SCRIPT = {
    "24dcc3458a78": {"xbee": "0013A20041F0AA01", "bursts": [(3, 9), (10, 14), (30, 32), (80, 90), (91, 96), (120, 121)],
                     "silent": (45, 65)},
    "ac1518ebf918": {"xbee": "0013A20041F0AA02", "bursts": [(5, 7), (20, 24), (25, 30), (72, 82), (125, 130)],
                     "reboot": 60, "sensor_error": (100, 110)},
}


class FakeNode:
    """Follows Motion::update() and the firmware's transmit rules (on change plus a 5 s heartbeat)."""
    def __init__(self, mac, script, motion, rng):
        self.mac, self.script, self.motion, self.rng = mac, script, motion, rng
        self.boot = f"{rng.getrandbits(32):08x}"
        self.revision, self.state, self.dirty = 1, "AVAILABLE", True
        self.last_tx, self.last_motion, self.move_start, self.mg = -1e9, -1e9, None, 0
        self.cycle = -1

    def set_state(self, state):
        if state != self.state:
            self.state, self.revision, self.dirty = state, self.revision + 1, True

    def step(self, t):
        packets, stale = [], []
        cycle, local = divmod(t, CYCLE)
        if cycle != self.cycle:
            self.cycle, self.done = cycle, set()
        s = self.script
        if "reboot" in s and local >= s["reboot"] and "reboot" not in self.done:
            self.done.add("reboot")
            old = (self.boot, self.revision + 5)
            self.boot = f"{self.rng.getrandbits(32):08x}"
            self.revision, self.state, self.dirty, self.last_tx = 1, "AVAILABLE", True, -1e9
            self.last_motion, self.move_start = -1e9, None
            # a late packet from before the reboot, which the stale check must drop
            stale.append(self.packet(*old, "ACTIVE"))
        moving = any(a <= local < b for a, b in s["bursts"])
        self.mg = self.rng.randint(150, 600) if moving else self.rng.randint(3, 40)
        error = "sensor_error" in s and s["sensor_error"][0] <= local < s["sensor_error"][1]
        if error:
            self.set_state("SENSOR_ERROR")
            self.mg, self.move_start = 0, None
        elif self.state == "SENSOR_ERROR":
            self.last_motion = -1e9
            self.set_state("AVAILABLE")
        else:
            if moving:
                self.move_start = t if self.move_start is None else self.move_start
                if t - self.move_start >= 0.08:
                    self.last_motion = t
                    self.set_state("ACTIVE")
            else:
                self.move_start = None
            if self.state != "AVAILABLE" and t - self.last_motion >= self.motion.restingTimeoutSeconds:
                self.set_state("AVAILABLE")
            elif self.state == "ACTIVE" and t - self.last_motion >= self.motion.restingDelaySeconds:
                self.set_state("RESTING")
        silent = "silent" in s and s["silent"][0] <= local < s["silent"][1]
        if not silent and (self.dirty or t - self.last_tx >= 5):
            packets.append(self.packet(self.boot, self.revision, self.state))
            self.dirty, self.last_tx = False, t
        return packets + stale

    def packet(self, boot, revision, state):
        return (f"GT1,{self.mac},{boot},{revision},{state},{self.mg}".encode("ascii"), self.script["xbee"])


def fake_nodes(motion, seed=None):
    rng = random.Random(seed)
    return [FakeNode(mac, script, motion, rng) for mac, script in SCRIPT.items()]


def fake_reader(deliver, status, motion, stop, step=0.02):
    nodes = fake_nodes(motion)
    status(True, "fake", "0013A20040FA4E00", 15)
    start = time.monotonic()
    while not stop.wait(step):
        t = time.monotonic() - start
        for node in nodes:
            for data, xbee in node.step(t):
                deliver(data, xbee, None)


def start_thread(target, *args):
    thread = threading.Thread(target=target, args=args, daemon=True)
    thread.start()
    return thread
