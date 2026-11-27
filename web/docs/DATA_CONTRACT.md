# Data Contract (v4, draft: agree on this with the team)

This defines what flows from the sensor nodes to the coordinator, the backend and
the website. The frontend's mock data must produce exactly these shapes, so
switching to real hardware only means switching `VITE_DATA_SOURCE` to `api`.

## 0. State machine (firmware and mock must match)

| From | To | Condition |
|---|---|---|
| AVAILABLE | ACTIVE | continuous movement above threshold for ≥ `ACTIVATION_SECONDS` (default 3 s) |
| ACTIVE | RESTING | movement stops |
| RESTING | ACTIVE | any movement again; resting timer resets to 0 |
| RESTING | AVAILABLE | no movement for `RESTING_TIMEOUT_SECONDS` (default 300 s = 5 min) continuously |
| ACTIVE | AVAILABLE | **never** |

Gym hours: open 6 am–11 pm; heatmaps cover the 7 am–9 pm blocks.
Admins may override a machine's state ("one-off" or "hold"); a held machine
ignores sensor events until released. Normal users can never change state.

MAINTENANCE is **not** a sensor state. It is a flag an admin sets on the backend.
While it is set, the machine's sensor events are ignored for display and stats.

### Timing: real sensor nodes vs simulated machines

This is the one place both timings are written down.

| | Real nodes (LE01, LP01) | Simulated machines (the other 29) |
|---|---|---|
| Source | `hardware/include/motion.h`, read by the bridge at startup and served at `GET /api/config` | `src/config/state-machine.ts` |
| Movement threshold | `thresholdG` (0.10 g) | n/a (the mock generates movement) |
| AVAILABLE → ACTIVE | 4 consecutive samples ≥ threshold at 50 Hz (~80 ms) | `ACTIVATION_SECONDS` = 3 s |
| ACTIVE → RESTING | `restingDelaySeconds` (0.4 s) after the last confirmed movement | movement stops |
| RESTING → AVAILABLE | `restingTimeoutSeconds` (`restTimeoutMs`, now **3 s**) after the **last confirmed movement**, so the timer includes the resting delay | `RESTING_TIMEOUT_SECONDS` = 300 s of stillness from RESTING |
| RESTING countdown | `restingTimeoutSeconds − restingDelaySeconds − (now − since)` | `RESTING_TIMEOUT_SECONDS − (now − since)` |
| ACTIVE → AVAILABLE | possible (a lost RESTING packet, or the accelerometer recovering from SENSOR_ERROR); accepted for real nodes only | never |
| Offline | `offlineAfterSeconds` = 16 s without a packet (`OFFLINE_AFTER` in `coordinator.py`), heartbeat every 5 s | 30 s heartbeats in the mock |
| Clock | real time, always | the demo's sim clock (speed 1×–240×) |

To change the real nodes to 5 minutes: set `restTimeoutMs = 300000` in
`motion.h`, reflash both nodes and restart the bridge. The website reads the
new value from `/api/config`, so no web code changes. The "≥ 300 s resting"
checks (`findViolation`, the long-run mock tests) apply to simulated machines
only.

## 1. Node → Coordinator (over XBee, as built)

The firmware (`hardware/src/main.cpp`) sends one packet on **every state
change** plus a **heartbeat every 5 s**, both in the same format:

```
GT1,<esp32 mac, 12 lower-case hex>,<boot id, 8 hex>,<revision>,<STATE>,<dynamic milli-g>
e.g.  GT1,24dcc3458a78,5f0c19a2,14,ACTIVE,312
```

- The packet regex is `PACKET` in `hardware/coordinator.py`. The bridge
  imports it, so there is one definition.
- `STATE` is `AVAILABLE | ACTIVE | RESTING | SENSOR_ERROR`. `SENSOR_ERROR`
  means the node is online but can't read its accelerometer. It is not a
  `MachineState`. The website shows it like OFFLINE, labelled "Sensor error".
- `boot id` is random on every boot. `revision` counts state changes since
  boot. Packets from an older boot id, or with a lower revision in the same
  boot, are stale and dropped.
- The MAC → machine mapping is in `bridge/machines.toml` (`24dcc3458a78` = LE01
  leg extension, `ac1518ebf918` = LP01 seated leg press).
- Timestamps are set by the bridge on arrival (ISO 8601 UTC).
- A node with no packet for 16 s is OFFLINE. A heartbeat updates
  `lastHeartbeat` and online status but isn't a state event. A node that
  reboots or comes back online sends its current state, which the bridge
  records as a new event.

## 2. Backend data model

```ts
type MachineState = "AVAILABLE" | "ACTIVE" | "RESTING";
type DisplayStatus = MachineState | "MAINTENANCE" | "OFFLINE"; // what the UI shows
// Priority: MAINTENANCE > OFFLINE > sensor state.
// MAINTENANCE and OFFLINE machines are excluded from live availability/in-use
// (numerator AND denominator) and their time is excluded from heatmaps/utilisation.

type MachineGroup = "legs" | "chest-shoulders-triceps" | "back-biceps" | "cardio";
type MachineKind =
  | "leg-extension" | "leg-press" | "leg-curl" | "hack-squat" | "hip-abductor"
  | "hip-adductor" | "calf-raise" | "smith-machine"
  | "chest-press" | "pec-deck" | "incline-press" | "cable-crossover"
  | "triceps-pushdown" | "assisted-dip"
  | "shoulder-press" | "lateral-raise" | "rear-delt"
  | "lat-pulldown" | "seated-row" | "assisted-pullup" | "t-bar-row"
  | "preacher-curl" | "biceps-curl"
  | "treadmill" | "rower" | "bike" | "elliptical";

interface StateEvent {
  machineId: string;      // "LP01"
  state: MachineState;
  timestamp: string;      // ISO 8601, set by backend on receipt
}

interface Maintenance {
  since: string;          // ISO
  reason: string;
  expectedBack: string | null;
}

interface Machine {
  id: string;
  name: string;           // "Seated Leg Press"
  zoneId: string;         // "legs" — used for cleaning load
  group: MachineGroup;
  kind: MachineKind;
  state: MachineState;    // last sensor state
  since: string;          // ISO time the current state began
  sessionStartedAt: string | null; // set while ACTIVE/RESTING
  maintenance: Maintenance | null; // non-null => DisplayStatus MAINTENANCE
  override: { mode: "one-off" | "hold"; by: string; at: string } | null; // admin manual state
  online: boolean;        // false if no packet/heartbeat for > 90 s (mock), > 16 s (real nodes)
  lastHeartbeat: string | null;
  prototype?: boolean;    // real sensor node in the demo
}

interface Session {
  machineId: string;
  start: string;          // AVAILABLE→ACTIVE
  lastActiveEnd: string;  // end of final ACTIVE period
  end: string;            // RESTING→AVAILABLE (lastActiveEnd + timeout)
  workoutSeconds: number; // start → lastActiveEnd   (shown as "session length")
  occupiedSeconds: number;// start → end             (used for utilisation/heatmaps)
  activeSeconds: number;
  restingSeconds: number;
}

// Kind-level availability (used by the workout planner)
interface KindAvailability {
  kind: MachineKind;
  units: string[];          // in-service unit ids (not maintenance/offline)
  pAnyFree: number[][];     // [day][block] share of time ≥1 unit free (from history)
  typicalFree: number[][];  // [day][block] average number of units free
}

// 7 days (Mon..Sun) × 7 blocks (7-9am .. 7-9pm); values 0..1 = fraction occupied
// Time a machine spent in maintenance is excluded from the averages.
interface Heatmap {
  machineId: string | "ALL";
  weeks: number;
  blocks: string[];       // ["7-9 am", "9-11 am", ...]
  days: string[];         // ["MON", ..., "SUN"]
  values: number[][];     // values[day][block]
  busiest: { day: string; block: string; value: number };
}

interface Summary {
  total: number;
  operational: number;    // total − in maintenance
  reporting: number;      // operational and online
  offline: number;
  available: number;
  active: number;
  resting: number;
  maintenance: number;
  utilisation: number;    // (active+resting)/reporting
  avgWorkoutSecondsToday: number;
  sessionsToday: number;
}

interface MachineStats {
  machineId: string;
  utilisation: { today: number; week: number; fourWeeks: number };
  rank: number;           // 1 = busiest
  groupAvgUtilisation: number;
  avgWorkoutSeconds: number;
  medianWorkoutSeconds: number;
  estimatedRemainingSeconds: number | null; // avg − current, ≥ 0; null if available
  sessionsPerDay: { date: string; count: number }[];
  recentSessions: Session[];
  maintenanceHistory: (Maintenance & { end: string | null })[];
  // Added in v4 so clients can leave offline time out of history, like maintenance.
  // since = last packet/heartbeat before the node went quiet; end = first packet after.
  offlineHistory: { since: string; end: string | null }[];
}
```

## 3. REST + WebSocket API (served by backend, e.g. Python/FastAPI)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/machines` | `Machine[]` |
| GET | `/api/machines/:id` | `Machine` |
| GET | `/api/machines/:id/stats` | `MachineStats` |
| GET | `/api/machines/:id/events?from=&to=` | `StateEvent[]` |
| GET | `/api/heatmap?machineId=ALL&weeks=4` | `Heatmap` |
| GET | `/api/summary` | `Summary` |
| GET | `/api/kinds/availability?weeks=4` | `KindAvailability[]` |
| POST | `/api/admin/login` | `{ token }` (body `{ username, password }`) |
| PUT | `/api/admin/machines/:id/maintenance` | `Machine` (body `Maintenance`; auth) |
| DELETE | `/api/admin/machines/:id/maintenance` | `Machine` (auth) |
| PUT | `/api/admin/machines/:id/state` | `Machine` (body `{ state, mode: "one-off" \| "hold" }`; auth) |
| DELETE | `/api/admin/machines/:id/state` | `Machine`, releases a hold (auth) |
| GET | `/api/admin/overrides` | audit log `{ machineId, from, to, mode, by, at }[]` (auth) |
| GET | `/api/admin/zones` | `{ zoneId, lastCleaned, sessionsSince, occupiedMinutesSince }[]` (auth) |
| POST | `/api/admin/zones/:zoneId/cleaned` | marks zone cleaned (auth) |
| GET | `/api/admin/export/popularity.csv` | CSV (auth) |
| WS  | `/ws` | pushes `{ type: "state", event }`, `{ type: "online", machineId, online }`, `{ type: "maintenance", machine }`, `{ type: "override", machine }` |

Base URL from `VITE_API_URL` (default `http://localhost:8000`). Admin calls send
`Authorization: Bearer <token>`.

## 4. Bridge API v1 (real sensor nodes, `bridge/server.py`)

Used by `VITE_DATA_SOURCE=hybrid`. It serves **only the real machines**. The
website runs the mock for the rest and merges the two. Base URL is
`VITE_API_URL` (default `http://localhost:8000`). CORS allows
`http://localhost:5173`, plus anything added with `--cors` or
`GYM_BRIDGE_CORS`. Everything is read-only.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ version, coordinatorConnected, port, coordinator: { connected, port, address, channel }, pan, uptimeSeconds, startedAt, motion: config & { missing: string[] } }` |
| GET | `/api/config` | `{ restingTimeoutSeconds, restingDelaySeconds, thresholdG, offlineAfterSeconds, source: "motion.h" \| "default" }` |
| GET | `/api/machines` | `bridgeMachine[]` (below) |
| GET | `/api/machines/:id` | `bridgeMachine`, 404 for an id that isn't a real node |
| GET | `/api/machines/:id/events?from=&to=&prior=` | recorded `StateEvent[]` in time order. Only machine states, with consecutive repeats (rejoins, reboots) collapsed. `prior=true` also returns the event just before `from` |
| GET | `/api/machines/:id/offline?from=&to=` | `{ since, end: string \| null, reason: "offline" \| "sensor_error" \| "not_recording" }[]`: every span since recording started without good data (`end` null = still going) |
| GET | `/api/recording` | `{ startedAt, now, machines: { machineId, hours, firstEventAt }[] }`, where `hours` = online time minus sensor-error time |
| WS | `/ws` | messages below |

```ts
interface bridgeMachine extends Machine {   // maintenance and override are always null (frontend only in hybrid mode)
  prototype: true;
  status: "WAITING" | "AVAILABLE" | "ACTIVE" | "RESTING" | "SENSOR_ERROR" | "OFFLINE";
  waiting: boolean;            // no packet since the bridge started
  sensorError: boolean;        // online, but STATE = SENSOR_ERROR (state keeps the last machine state)
  dynamicG: number | null;     // from the last packet
  xbeeAddress: string | null;  // 64-bit source address
  bootId: string | null;
  revision: number | null;
  onlineSince: string | null;
  label: string;               // "Machine 1"
  mac: string;
}
```

WebSocket messages (the server sends them, the client sends nothing):

| `type` | Fields | When |
|---|---|---|
| `snapshot` | `machines, config, coordinator, recording` | right after connecting |
| `state` | `event: StateEvent, machine` | the machine state changed |
| `machine` | `machine` | anything else that came in a state packet: SENSOR_ERROR starts or ends, rejoin or reboot in the same state |
| `online` | `machineId, online, machine` | first packet after WAITING/OFFLINE, or 16 s silence |
| `heartbeat` | `machineId, dynamicG, lastHeartbeat, revision` | at most 1 per second per machine |
| `coordinator` | `connected, port, address, channel` | USB coordinator opened or lost |

Storage (`bridge/data/gym.db`, SQLite): `events` (every accepted state packet:
machine id, state incl. SENSOR_ERROR, time, dynamic mg, boot id, revision,
XBee address, reason boot/rejoin/change), `intervals` (online, offline,
sensor_error), `nodes` (last heartbeat per node) and `meta` (recording start).

### Website side of hybrid mode (`VITE_DATA_SOURCE=hybrid`)

`HybridDataSource` runs the mock for every machine except the real nodes
(`prototype: true` in `gym-layout.ts`) and takes those from the bridge. It
adds optional fields that mock and api mode never set:

- `Machine.sensor` (`dynamicG`, `xbeeAddress`, `bootId`, `revision`,
  `onlineSince`, `waiting`, `sensorError`, `bridgeConnected`,
  `coordinatorConnected`, `offlineAfterSeconds`). A real node that is WAITING,
  in SENSOR_ERROR, behind an unreachable bridge or an unplugged coordinator has
  `online: false`, so the eligibility rules leave it out like OFFLINE. The
  label says why ("Sensor error", "Waiting for sensor", "Bridge not
  connected", "Coordinator unplugged").
- `Machine.timing` (`restingTimeoutSeconds`, `restingDelaySeconds`, `source`)
  from `/api/config`. A machine with `timing` runs on real time, never on the
  demo's sim clock.
- `Heatmap.coverage`: share of each block with recorded data. `0` is drawn
  hatched as "no data", not 0 %.
- `MachineStats.recording` and `KindAvailability.collectingData`: rankings
  and the planner say "collecting data" / "not enough data yet" until a real
  node has `MIN_RECORDED_HOURS` (`src/config/real-sensors.ts`, default 24 h).
- `liveMessage` `{ type: "machine", machine }`: any other change to a real
  node (heartbeat, sensor error, bridge status).

Admin maintenance and overrides on a real node only exist in the browser in
hybrid mode. A hold pins what the website shows, and the bridge keeps
recording every packet anyway.
