# /// script
# requires-python = ">=3.10"
# dependencies = ["digi-xbee==1.5.0", "pyserial==3.5"]
# ///
"""Live terminal for the GymTracker Zigbee coordinator."""
import argparse
from dataclasses import dataclass
from datetime import datetime
import re
import time

import serial
from serial.tools import list_ports
from digi.xbee.devices import ZigBeeDevice
from digi.xbee.exception import TimeoutException, XBeeException

PAN = 0x47594D31
NAMES = {"24dcc3458a78": "Machine 1", "ac1518ebf918": "Machine 2"}
PACKET = re.compile(rb"GT1,([0-9a-f]{12}),([0-9a-f]{8}),(\d{1,10}),(AVAILABLE|ACTIVE|RESTING|SENSOR_ERROR),(\d{1,6})")
OFFLINE_AFTER = 16


def choose_port():
    candidates = [p.device for p in list_ports.comports() if (p.vid, p.pid) == (0x0403, 0x6015)]
    if len(candidates) != 1:
        raise ValueError("Select the coordinator USB adapter with --port COM7 (use its current port).")
    return candidates[0]


def port_present(port):
    return any(p.device.casefold() == port.casefold() for p in list_ports.comports())


def enable_api(port):
    # The S2C lab radios may ship in transparent mode. An API radio may also
    # accept the guarded escape. Only write AP if this setting actually changes.
    with serial.Serial(port, 9600, timeout=2) as uart:
        time.sleep(1.2)
        uart.reset_input_buffer()
        uart.write(b"+++")
        if uart.read_until(b"\r") != b"OK\r":
            return
        def at(command):
            uart.write(b"AT" + command + b"\r")
            return uart.read_until(b"\r").strip()
        try:
            current = at(b"AP")
            if current == b"0" and (at(b"AP1") != b"OK" or at(b"WR") != b"OK"):
                raise ValueError("The coordinator could not save API mode.")
        finally:
            at(b"CN")


def configure(device):
    changes = []
    for command, value in (("ID", PAN.to_bytes(8,"big")), ("CE", b"\x01"), ("EE", b"\x00")):
        if int.from_bytes(device.get_parameter(command), "big") != int.from_bytes(value, "big"):
            changes.append((command, value))
    if changes:
        for command, value in changes:
            device.set_parameter(command, bytearray(value), apply=False)
        device.apply_changes()
        device.write_changes()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if int.from_bytes(device.get_parameter("AI"),"big") == 0:
            if (int.from_bytes(device.get_parameter("CE"),"big") == 1 and
                    int.from_bytes(device.get_parameter("OP"),"big") == PAN):
                return
        time.sleep(.5)
    raise ValueError("Coordinator did not form the GYM1 network within 30 seconds.")


@dataclass
class Reading:
    boot: str
    revision: int
    state: str
    received: float
    online: bool = True


def event(text):
    print(f"{datetime.now():%H:%M:%S}  {text}", flush=True)


def monitor(device, check_links=False):
    nodes = {}
    old_boots = {}
    last_port_check = time.monotonic()
    print("GymTracker   |   Live Zigbee activity   |   Ctrl+C to close", flush=True)
    for label in NAMES.values():
        event(f"{label:<12} WAITING")
    while True:
        try:
            msg = device.read_data(timeout=1)
        except TimeoutException:
            msg = None
        now = time.monotonic()
        if not msg and now-last_port_check >= 4:
            last_port_check = now
            if not port_present(device.serial_port.port):
                raise serial.SerialException("Coordinator USB adapter disconnected.")
        if msg and (packet := PACKET.fullmatch(msg.data)):
            key, boot, seq, state, mg = (v.decode("ascii") for v in packet.groups())
            revision = int(seq)
            previous = nodes.get(key)
            retired = old_boots.setdefault(key, set())
            if boot not in retired and not (previous and previous.boot == boot and revision < previous.revision):
                if previous and boot != previous.boot:
                    retired.add(previous.boot)
                rejoined = not previous or not previous.online or previous.boot != boot
                changed = rejoined or previous.state != state
                nodes[key] = Reading(boot, revision, state, now)
                if changed:
                    radio = msg.remote_device.get_64bit_addr()
                    event(f"{NAMES.get(key,key):<12} {state:<13} {int(mg)/1000:.3f} g dynamic   XBee {radio}")
                if check_links and rejoined:
                    try:
                        version = msg.remote_device.get_parameter("VR").hex().upper()
                        event(f"{NAMES.get(key,key):<12} Radio answered coordinator query (firmware {version})")
                    except XBeeException as error:
                        event(f"{NAMES.get(key,key):<12} Coordinator query failed ({error})")
        for key, reading in nodes.items():
            if reading.online and now - reading.received >= OFFLINE_AFTER:
                reading.online = False
                event(f"{NAMES.get(key,key):<12} OFFLINE")


def run_monitor(port, setup, check_links):
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
        print(f"Coordinator {device.get_64bit_addr()} on {port}, PAN {PAN:016X}, channel {channel}", flush=True)
        monitor(device, check_links)
    finally:
        device.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", help="USB coordinator port, autodetected when omitted")
    parser.add_argument("--setup", action="store_true", help="set the attached radio as the GYM1 coordinator and save settings")
    parser.add_argument("--check-links", action="store_true", help="query each radio over the air when it joins or reconnects")
    args = parser.parse_args()
    port = args.port or choose_port()
    while True:
        try:
            run_monitor(port, args.setup, args.check_links)
            return
        except (XBeeException, serial.SerialException):
            if port_present(port):
                raise
            event(f"Coordinator disconnected. Waiting for {port}.")
            while not port_present(port):
                time.sleep(1)
            time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (XBeeException, ValueError, serial.SerialException) as error:
        raise SystemExit(f"Coordinator: {error}")
