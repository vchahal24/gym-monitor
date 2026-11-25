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

## 1. Node → Coordinator (over XBee, proposed)

Sent **only on state change** (per the proposal), plus an optional heartbeat
every 30 s so the backend can detect a dead node.

Plain-text line in XBee transparent (AT) mode, newline-terminated:

```
<machine_id>,<state>,<uptime_ms>\n
e.g.  LP01,ACTIVE,184233
      LP01,HB,214233        <- heartbeat, state unchanged
```

- `machine_id`: hard-coded per node = **kind code + 2-digit unit number**
  (max 6 chars), e.g. `LE01` leg extension, `LP01` seated leg press,
  `LPD01` lat pulldown, `TM01`–`TM04` treadmills. Full list in
  `src/config/gym-layout.ts`.
  Prototype nodes: **LE01 = leg extension, LP01 = seated leg press**.
- `state`: `AVAILABLE` | `ACTIVE` | `RESTING` | `HB`
- `uptime_ms`: `millis()` on the node (the backend adds the real timestamp)
- On (re)joining the network the node should send its **current state** once
  (a normal state line), so the backend re-syncs straight away. Heartbeats
  don't carry the state. *(Proposed in v4; firmware to confirm.)*

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
  online: boolean;        // false if no packet/heartbeat for > 90 s
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
