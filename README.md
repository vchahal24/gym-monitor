# Gym Monitor

ENGG*4200 Group 1. Wireless gym equipment monitoring: ESP32 + MPU-6050 + XBee
nodes on the machines, a USB XBee coordinator on a PC, and a website.

| Folder | Contents |
|---|---|
| `hardware/` | Node firmware and `coordinator.py` (the group's working code, run on its own as before) |
| `bridge/` | Connects the coordinator to the website: same live terminal as `coordinator.py`, plus SQLite recording and an HTTP/WebSocket API ([bridge/README.md](bridge/README.md)) |
| `web/` | The website (Vite + React). `npm run dev` = everything simulated, `npm run dev:hybrid` = real LE01/LP01 + the rest simulated |

## Running with real hardware

You need [uv](https://docs.astral.sh/uv/) and Node.js. Install the website's
dependencies once with `npm install` in `web/`.

1. **Plug in the USB XBee coordinator** and **power both sensor nodes**
   (Machine 1 = LE01 Leg Extension, Machine 2 = LP01 Seated Leg Press).
2. **Close `coordinator.py` / Start GymTracker.cmd** if it's running. Only one
   program can open the coordinator port.
3. **Start the bridge** in its own terminal and leave it running:
   - Windows: double-click `bridge\Start Bridge.cmd`, or
     `cd bridge` then `uv run --python 3.11 server.py` (add `--port COM7` if
     autodetection finds more than one adapter)
   - Linux: `./bridge/start-bridge.sh` (add `--port /dev/ttyUSB0` if needed;
     your user must be in the `uucp` group, see `bridge/README.md`)

   It prints the same live log as `coordinator.py`: WAITING, then each
   machine's state as packets arrive.
4. **Start the website** in a second terminal:
   ```
   cd web
   npm run dev:hybrid
   ```
5. **Open http://localhost:5173.** The header should say **Live sensors**.
   LE01 and LP01 carry the LIVE badge and follow the sensors. The other
   machines are simulated.

**Bench check:** move a sensor continuously for about 1 s, then keep it still
for 4 s. Both the bridge terminal and the website should show that machine go
**ACTIVE → RESTING → AVAILABLE** (RESTING about 0.4 s after the movement
stops, AVAILABLE 3 s after the last movement). Moving it again while RESTING
should return it to ACTIVE.

If something's off, the header tells you which part:

| Header | Meaning |
|---|---|
| Live sensors | everything connected |
| Bridge offline | the website can't reach the bridge, so check that its terminal is still running. The site retries by itself |
| Coordinator unplugged | the bridge is running but the USB coordinator isn't connected. It reconnects when the adapter is plugged back in |

On a machine tile, "Waiting for sensor" means that node hasn't sent anything
since the bridge started (check its power). "Sensor error" means the node is
online but can't read its accelerometer.

**No hardware?** Start the bridge with `--fake` (`./bridge/start-bridge.sh
--fake`, or `uv run --python 3.11 server.py --fake` on Windows). It simulates
both nodes, including a reboot, a sensor error and 20 s of silence that sends
LE01 OFFLINE and back.

Real events are recorded to `bridge/data/gym.db`. The real machines' heatmaps
and stats are built only from that data and say "collecting data" until there
are 24 h of it (`MIN_RECORDED_HOURS` in `web/src/config/real-sensors.ts`).

## Tests

```
cd web && npm run build && npm run lint && npm run test
cd bridge && uv run --python 3.11 --with-requirements requirements-dev.txt -m pytest
```
