# GymTracker bridge

The bridge connects the USB XBee coordinator to the website. It does everything
`hardware/coordinator.py` does: it prints the same live terminal log and
supports the same `--port`, `--setup` and `--check-links` flags. It also
records every real sensor event to SQLite and serves the data to the website
over HTTP and WebSocket ("Bridge API v1" in `web/docs/DATA_CONTRACT.md`).

It imports `PACKET`, `PAN`, `OFFLINE_AFTER`, `choose_port`, `port_present`,
`enable_api` and `configure` from `hardware/coordinator.py`, and reads the
motion timing from `hardware/include/motion.h` at startup. Nothing in
`hardware/` is copied or changed.

**Only one program can open the coordinator port.** Close `coordinator.py`
(or `Start GymTracker.cmd`) before you start the bridge. The bridge's terminal
shows the same information.

| File | Contents |
|---|---|
| `machines.toml` | **The one mapping** from ESP32 MAC to website machine (`24dcc3458a78` → LE01, `ac1518ebf918` → LP01), plus the CORS origins |
| `server.py` | Entry point (PEP 723 script): CLI, HTTP/WebSocket API |
| `tracker.py` | Node state: coordinator's stale-packet rules, WAITING / state / OFFLINE, heartbeats |
| `sources.py` | XBee reader thread (reconnects when the adapter is unplugged) and the `--fake` nodes |
| `store.py` | SQLite storage (`data/gym.db` by default, not committed) |
| `motion_config.py` | Reads `thresholdG`, `restTimeoutMs` and the 0.4 s resting delay from `motion.h` |

## Running it

You need [uv](https://docs.astral.sh/uv/). The first run downloads Python 3.11 and the dependencies.

**Linux**
```sh
./bridge/start-bridge.sh              # real coordinator, autodetected
./bridge/start-bridge.sh --fake       # no hardware: two simulated nodes
./bridge/start-bridge.sh --port /dev/ttyUSB0 --check-links
```

**Windows**: double-click **Start Bridge.cmd**, or run:
```powershell
cd bridge
uv run --python 3.11 server.py
uv run --python 3.11 server.py --fake
uv run --python 3.11 server.py --port COM7 --check-links
```

| Flag | Meaning |
|---|---|
| `--port` | Coordinator port (`COM7`, `/dev/ttyUSB0`). Autodetects the project's FTDI adapter when omitted |
| `--setup` | Makes the attached radio the GYM1 coordinator (same as `coordinator.py --setup`) |
| `--check-links` | Asks each radio for its firmware version when it joins or reconnects |
| `--http-port` | API port, default `8000` |
| `--host` | Bind address, default `127.0.0.1`. Use `0.0.0.0` to reach it from other devices on the LAN |
| `--db` | SQLite file, default `bridge/data/gym.db` |
| `--cors` | Extra allowed website origins (comma separated, repeatable). The `GYM_BRIDGE_CORS` env var works too |
| `--fake` | Generates `GT1` packets for both MACs and sends them through the same parser. The 150 s script includes heartbeats, a reboot of Machine 2 (followed by a stale packet from the old boot, which gets dropped), a sensor error, and 20 s of silence from Machine 1, which goes OFFLINE after 16 s and comes back |

Open http://localhost:8000/api/health to check that it's up.

### Finding the port

- **Linux:** `ls /dev/ttyUSB*` (or `dmesg | tail` after plugging it in). The
  serial ports belong to the `uucp` group on Arch and CachyOS (`dialout` on
  Debian and Ubuntu). Add yourself once, then log out and back in:
  `sudo usermod -aG uucp $USER`. Check with `id -nG`.
- **Windows:** Device Manager → Ports (COM & LPT) → "USB Serial Port (COMx)".
  Pass it as `--port COM7` if autodetection finds more than one adapter.

If the adapter is unplugged, the bridge keeps serving the website, reports
"Coordinator unplugged" and reconnects when the adapter comes back. If you
start the bridge before plugging in the adapter, it waits.

## Timing

The two real machines use the firmware's timing, read from `motion.h` at
startup and served at `/api/config`. If a value can't be read, the bridge
logs it and uses the default (0.10 g, 0.4 s, 3 s), and `/api/config` reports
`"source": "default"`. The simulated machines use
`web/src/config/state-machine.ts`. Both are described in
`web/docs/DATA_CONTRACT.md` §0.

To change to 5 minutes: set `restTimeoutMs = 300000` in
`hardware/include/motion.h`, reflash both nodes and restart the bridge. The
website picks the new value up from `/api/config`, so no web change is needed.

## Tests

No hardware needed:
```sh
cd bridge
uv run --python 3.11 --with-requirements requirements-dev.txt -m pytest
```

## Hosting the website later (Vercel)

The bridge has to stay on the PC that has the USB coordinator, because Vercel
can't reach USB. To let a hosted site collect a week of real data:

1. **Tunnel (least work):** keep the bridge running on the PC and expose port
   8000 with a tunnel (Cloudflare Tunnel, Tailscale Funnel, ngrok). Build the
   site with `VITE_API_URL=https://<tunnel-host>` and start the bridge with
   `--cors https://<your-site>.vercel.app`. The data stays in
   `bridge/data/gym.db` on the PC, and the site shows "Bridge offline" whenever
   the PC is off. The API is read-only (GET and WebSocket), but anyone with the
   URL can read it.
2. **Push to a hosted database:** have the bridge also write each event and
   interval to a hosted store (Postgres, Supabase, Turso), and serve the same
   Bridge API v1 from a serverless function. More work, but the site keeps its
   history when the PC is off. Live updates would need polling or the
   database's realtime feature in place of `/ws`.

Both options only need the configurable API base URL (`VITE_API_URL`) and the
CORS origins that already exist.
