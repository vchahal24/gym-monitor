// SHARED DOMAIN TYPES
// Purpose: the shapes from docs/DATA_CONTRACT.md §2, exactly, both the mock and api data sources make these
// dont add fields here without updating the contract first

export type MachineState = "AVAILABLE" | "ACTIVE" | "RESTING"

export const MACHINE_STATES: readonly MachineState[] = ["AVAILABLE", "ACTIVE", "RESTING"]

// what the UI shows, MAINTENANCE is an admin flag and OFFLINE means the node isnt reporting
// neither is a sensor state, MAINTENANCE beats OFFLINE beats the sensor state (see src/lib/eligibility.ts)
export type DisplayStatus = MachineState | "MAINTENANCE" | "OFFLINE"

export const DISPLAY_STATUSES: readonly DisplayStatus[] = ["AVAILABLE", "ACTIVE", "RESTING", "MAINTENANCE", "OFFLINE"]

export type MachineGroup = "legs" | "chest-shoulders-triceps" | "back-biceps" | "cardio"

export const MACHINE_GROUPS: readonly MachineGroup[] = ["legs", "chest-shoulders-triceps", "back-biceps", "cardio"]

export type MachineKind =
  | "leg-extension"
  | "leg-press"
  | "leg-curl"
  | "hack-squat"
  | "hip-abductor"
  | "hip-adductor"
  | "calf-raise"
  | "smith-machine"
  | "chest-press"
  | "pec-deck"
  | "incline-press"
  | "cable-crossover"
  | "triceps-pushdown"
  | "assisted-dip"
  | "shoulder-press"
  | "lateral-raise"
  | "rear-delt"
  | "lat-pulldown"
  | "seated-row"
  | "assisted-pullup"
  | "t-bar-row"
  | "preacher-curl"
  | "biceps-curl"
  | "treadmill"
  | "rower"
  | "bike"
  | "elliptical"

export interface Maintenance {
  since: string // ISO
  reason: string
  expectedBack: string | null // ISO, or null if unknown
}

export type overrideMode = "one-off" | "hold"

export interface machineOverride {
  mode: overrideMode
  by: string // admin username
  at: string // ISO
}

// one audit log entry, GET /api/admin/overrides
export interface OverrideLogEntry {
  machineId: string
  from: MachineState
  to: MachineState
  mode: overrideMode
  by: string
  at: string
}

// GET /api/admin/zones
export interface zoneLoad {
  zoneId: string
  lastCleaned: string // ISO
  sessionsSince: number
  occupiedMinutesSince: number
}

// a past or current maintenance period (still going if end is null)
export type maintenanceRecord = Maintenance & { end: string | null }

// a past or current spell with no packets or heartbeats from the node (still going if end is null)
export interface offlineRecord {
  since: string // ISO, last packet/heartbeat before the node went quiet
  end: string | null // ISO, first packet after it came back, null if still offline
}

export interface StateEvent {
  machineId: string
  state: MachineState
  timestamp: string // ISO 8601, set by the backend on receipt
}

export interface Machine {
  id: string
  name: string // "Seated Leg Press"
  zoneId: string // "legs", the floor zone, used for the cleaning load
  group: MachineGroup
  kind: MachineKind
  state: MachineState // last sensor state
  since: string // ISO time the current state began
  sessionStartedAt: string | null // set while ACTIVE/RESTING
  maintenance: Maintenance | null // non-null ⇒ DisplayStatus MAINTENANCE
  override: machineOverride | null // admin set state, with "hold" it ignores sensor events until released
  online: boolean // false if no packet/heartbeat for > 90 s
  lastHeartbeat: string | null
  prototype?: boolean // real sensor node in the demo
}

export interface Session {
  machineId: string
  start: string // AVAILABLE→ACTIVE
  lastActiveEnd: string // end of the final ACTIVE period
  end: string // RESTING→AVAILABLE (lastActiveEnd + timeout)
  workoutSeconds: number // start → lastActiveEnd, shown to users as "session length"
  occupiedSeconds: number // start → end, used for utilisation and heatmaps (the machine looked taken)
  activeSeconds: number
  restingSeconds: number
}

// availability per kind (GET /api/kinds/availability)
// for the units of a kind in service now, how often at least one was free
export interface KindAvailability {
  kind: MachineKind
  units: string[] // in-service unit ids (not in maintenance, not offline)
  pAnyFree: number[][] // [day][block] share of that blocks time when ≥ 1 unit was free (from history, minute by minute)
  typicalFree: number[][] // [day][block] average number of units free
}

// 7 days (Mon..Sun) x 7 blocks (7-9am .. 7-9pm), values 0..1 = share of time in use
export interface Heatmap {
  machineId: string | "ALL"
  weeks: number // how many weeks averaged
  blocks: string[]
  days: string[]
  values: number[][] // values[day][block]
  busiest: { day: string; block: string; value: number }
}

export interface Summary {
  total: number
  operational: number // total − in maintenance
  reporting: number // operational and online, live figures are out of this
  offline: number // operational but not reporting
  available: number
  active: number
  resting: number
  maintenance: number
  utilisation: number // (active+resting) / reporting
  avgWorkoutSecondsToday: number
  sessionsToday: number
}

export interface MachineStats {
  machineId: string
  utilisation: { today: number; week: number; fourWeeks: number } // share of in service opening hours (7 am - 9 pm) occupied
  rank: number // by 4 week utilisation out of all machines, 1 = busiest
  groupAvgUtilisation: number
  avgWorkoutSeconds: number
  medianWorkoutSeconds: number
  estimatedRemainingSeconds: number | null // avg workout − current, >= 0, null if its available
  sessionsPerDay: { date: string; count: number }[]
  recentSessions: Session[]
  maintenanceHistory: maintenanceRecord[] // newest first
  offlineHistory: offlineRecord[] // newest first, offline time is left out of utilisation like maintenance
}

// messages pushed over the /ws WebSocket (contract §3)
export type liveMessage =
  | { type: "state"; event: StateEvent }
  | { type: "online"; machineId: string; online: boolean }
  | { type: "maintenance"; machine: Machine }
  | { type: "override"; machine: Machine }

// frontend only, how the UI is connected to its data
// mock = simulation in the browser, live = WebSocket open to the backend
export type connectionStatus = "mock" | "connecting" | "live" | "disconnected"
