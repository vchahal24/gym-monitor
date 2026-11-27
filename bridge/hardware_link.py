"""Imports the group's coordinator.py so the packet format has one source."""
from pathlib import Path
import sys

HARDWARE = Path(__file__).resolve().parent.parent / "hardware"

# hardware/ must stay untouched, so no .pyc is written next to coordinator.py
_writes = sys.dont_write_bytecode
sys.dont_write_bytecode = True
if str(HARDWARE) not in sys.path:
    sys.path.append(str(HARDWARE))
try:
    import coordinator
finally:
    sys.dont_write_bytecode = _writes

PACKET = coordinator.PACKET
PAN = coordinator.PAN
OFFLINE_AFTER = coordinator.OFFLINE_AFTER
NAMES = coordinator.NAMES
choose_port = coordinator.choose_port
port_present = coordinator.port_present
enable_api = coordinator.enable_api
configure = coordinator.configure
