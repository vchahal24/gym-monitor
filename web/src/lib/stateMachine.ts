// SENSOR STATE MACHINE
// Purpose: the sensor nodes state machine (docs/DATA_CONTRACT.md §0) as a pure function over movement
// the mock runs its simulated movement through this so its events follow the exact rules the firmware will
// this must match the ESP32 firmware, its also the reference for porting it over

// timing constants (shared with the firmware) + types
import { ACTIVATION_MS, RESTING_TIMEOUT_MS } from "../config/state-machine"
import type { MachineState } from "../types"

// a span of continuous movement above the threshold, epoch ms
export interface movement {
  start: number
  end: number
}

export interface transition {
  state: MachineState
  at: number
}

export interface initialState {
  state: MachineState
  since: number // when state began, for RESTING thats when movement stopped (the timer start)
}

// runs the state machine over movements (sorted, no overlaps) and returns the state changes
//   i. AVAILABLE: a movement longer than ACTIVATION_MS gives ACTIVE at start + ACTIVATION_MS, shorter bumps dont count
//   ii. ACTIVE: when the movement ends we go RESTING at end
//   iii. RESTING: movement starting within RESTING_TIMEOUT_MS of the rest gives ACTIVE at start (timer resets when it stops)
//        otherwise it already went AVAILABLE at restStart + RESTING_TIMEOUT_MS and the movement is judged again from AVAILABLE
//   iv. ACTIVE never goes straight to AVAILABLE
//
// finish closes a RESTING at the end with AVAILABLE after the timeout
// until only returns changes at or before until (plus the trailing timeout if its passed by then)
export function runStateMachine(
  movements: readonly movement[],
  initial: initialState = { state: "AVAILABLE", since: Number.NEGATIVE_INFINITY },
  { finish = false, until }: { finish?: boolean; until?: number } = {},
): transition[] {
  const limit = until ?? Number.POSITIVE_INFINITY
  const out: transition[] = []
  let state = initial.state
  let restStart = initial.since
  // records a change, false once were past the limit
  function emit(s: MachineState, at: number) {
    if (at > limit) return false
    out.push({ state: s, at })
    state = s
    return true
  }

  for (const m of movements) {
    if (m.start > limit) break
    if (m.end <= m.start) continue

    if (state === "RESTING") {
      if (m.start - restStart < RESTING_TIMEOUT_MS) {
        if (!emit("ACTIVE", m.start)) break
        if (!emit("RESTING", m.end)) break
        restStart = m.end
        continue
      }
      if (!emit("AVAILABLE", restStart + RESTING_TIMEOUT_MS)) break
    }

    if (state === "AVAILABLE") {
      if (m.end - m.start > ACTIVATION_MS) {
        if (!emit("ACTIVE", m.start + ACTIVATION_MS)) break
        if (!emit("RESTING", m.end)) break
        restStart = m.end
      }
      continue
    }

    if (state === "ACTIVE") {
      // it was already moving when we started, so this movement ending stops it
      if (!emit("RESTING", m.end)) break
      restStart = m.end
    }
  }

  if (state === "RESTING") {
    const at = restStart + RESTING_TIMEOUT_MS
    if (finish || (until !== undefined && at <= until)) emit("AVAILABLE", at)
  }
  return out
}

// checks one machines events against the rules, returns the first thing wrong or null
// the tests use it, and its handy for checking real hardware logs later
// realSensor relaxes the rules a real node can break: the firmware times out from the last movement (3 s on the bench)
// and a lost RESTING packet or a sensor error can give ACTIVE→AVAILABLE, so only order and repeats are checked
export function findViolation(events: readonly { state: MachineState; timestamp: string }[], { realSensor = false } = {}): string | null {
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]
    const cur = events[i]
    const dt = Date.parse(cur.timestamp) - Date.parse(prev.timestamp)
    if (dt < 0) return `event ${i} is earlier than the one before it`
    if (prev.state === cur.state) return `event ${i} repeats ${cur.state}`
    if (realSensor) continue
    if (prev.state === "ACTIVE" && cur.state === "AVAILABLE") return `event ${i}: ACTIVE→AVAILABLE at ${cur.timestamp}`
    if (prev.state === "RESTING" && cur.state === "AVAILABLE" && dt < RESTING_TIMEOUT_MS) {
      return `event ${i}: RESTING→AVAILABLE after only ${dt / 1000} s at ${cur.timestamp}`
    }
  }
  return null
}
