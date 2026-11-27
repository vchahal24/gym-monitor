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
  // hybrid mode only, set on the real nodes (LE01, LP01) from the bridge (contract §4), never by the mock or api
  sensor?: sensorDetails
  timing?: machineTiming
}

// what the bridge knows about a real node, for the machine page and the offline label
// a node in SENSOR_ERROR, WAITING or behind a dead bridge has online false so it drops out of live stats like OFFLINE
export interface sensorDetails {
  dynamicG: number | null // dynamic acceleration in the last packet, in g
  xbeeAddress: string | null
  bootId: string | null
  revision: number | null
  onlineSince: string | null
  waiting: boolean // no packet since the bridge started
  sensorError: boolean // the node reports but its accelerometer is failing
  bridgeConnected: boolean
  coordinatorConnected: boolean
  offlineAfterSeconds: number // the bridge calls the node OFFLINE after this long without a packet
}

// a real nodes timing from hardware/include/motion.h (GET /api/config)
// AVAILABLE comes restingTimeoutSeconds after the last movement and RESTING restingDelaySeconds after it,
// so a RESTING countdown starts at restingTimeoutSeconds - restingDelaySeconds
// real nodes always run on real time, never the demos sim clock
export interface machineTiming {
  restingTimeoutSeconds: number
  restingDelaySeconds: number
  source: "motion.h" | "default"
}

// GET /api/config
export interface motionConfig extends machineTiming {
  thresholdG: number
  offlineAfterSeconds: number
}

// how much real data a real node has (GET /api/recording)
export interface recordingInfo {
  since: string | null // when recording started, null if the bridge was never reached
  hours: number // hours of good data
  enough: boolean // at least MIN_RECORDED_HOURS (src/config/real-sensors.ts)
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
  collectingData?: boolean // every unit is a real node without enough recorded data yet (hybrid mode)
}

// 7 days (Mon..Sun) x 7 blocks (7-9am .. 7-9pm), values 0..1 = share of time in use
export interface Heatmap {
  machineId: string | "ALL"
  weeks: number // how many weeks averaged
  blocks: string[]
  days: string[]
  values: number[][] // values[day][block]
  busiest: { day: string; block: string; value: number }
  // optional, share of each block that had data (0 = no data at all, shown hatched instead of 0 %)
  coverage?: number[][]
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
  recording?: recordingInfo // real nodes in hybrid mode only
}

// messages pushed over the /ws WebSocket (contract §3)
export type liveMessage =
  | { type: "state"; event: StateEvent }
  | { type: "online"; machineId: string; online: boolean }
  | { type: "maintenance"; machine: Machine }
  | { type: "override"; machine: Machine }
  | { type: "machine"; machine: Machine } // hybrid mode, anything else about a real node changed (heartbeat, sensor error, bridge)

// frontend only, how the UI is connected to its data
// mock = simulation in the browser, live = WebSocket open to the backend
export type connectionStatus = "mock" | "connecting" | "live" | "disconnected"

// hybrid mode only, how the website is connected to the bridge and the bridge to the USB coordinator
export type bridgeStatus = "connecting" | "live" | "bridge-offline" | "coordinator-unplugged"
