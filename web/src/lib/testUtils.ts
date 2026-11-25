// TEST HELPERS
// Purpose: small builders for dates and state events so the tests stay short

import type { MachineState, StateEvent } from "../types"

// local time date, month is 1 based
// for example d(2026, 11, 16, 17, 30) is Mon 16 Nov 2026 5:30 pm
export function d(y: number, month: number, day: number, h = 0, min = 0, s = 0): Date {
  return new Date(y, month - 1, day, h, min, s)
}

// one state event for a machine at a time
export function ev(machineId: string, state: MachineState, at: Date): StateEvent {
  return { machineId, state, timestamp: at.toISOString() }
}

// one whole session: ACTIVE at start, RESTING after activeMin, AVAILABLE after restMin more
export function session(machineId: string, start: Date, activeMin: number, restMin: number): StateEvent[] {
  const t1 = new Date(start.getTime() + activeMin * 60_000)
  const t2 = new Date(t1.getTime() + restMin * 60_000)
  return [ev(machineId, "ACTIVE", start), ev(machineId, "RESTING", t1), ev(machineId, "AVAILABLE", t2)]
}
