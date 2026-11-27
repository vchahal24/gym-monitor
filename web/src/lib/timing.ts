// PER MACHINE TIMING
// Purpose: which timeout and which clock a machine runs on
// simulated machines use src/config/state-machine.ts and the data clock (the demos sim clock)
// real nodes in hybrid mode use the firmware timing (Machine.timing, from /api/config) and real time

import { RESTING_TIMEOUT_SECONDS } from "../config/state-machine"
import type { Machine } from "../types"

type timed = Pick<Machine, "timing">

// a real sensor node (hybrid mode)
export function isRealSensor(m: timed): boolean {
  return m.timing !== undefined
}

// seconds from the last movement until the machine goes AVAILABLE
export function restingTimeoutSecondsFor(m: timed): number {
  return m.timing ? m.timing.restingTimeoutSeconds : RESTING_TIMEOUT_SECONDS
}

// seconds from the RESTING event until AVAILABLE, aka what the countdown starts at
// the firmware times AVAILABLE from the last movement and RESTING comes restingDelaySeconds after it
export function countdownStartSeconds(m: timed): number {
  if (!m.timing) return RESTING_TIMEOUT_SECONDS
  return Math.max(0, m.timing.restingTimeoutSeconds - m.timing.restingDelaySeconds)
}

// the "now" for a machines timers, real nodes ignore the demos sim clock
export function nowFor(m: timed, now: Date, realNow: number = Date.now()): Date {
  return m.timing ? new Date(realNow) : now
}
