// TIME REMAINING AND COUNTDOWNS
// Purpose: the live timers shown on a machine, how long until its free and the resting countdown

// types + per machine timing (simulated vs real nodes)
import type { Machine } from "../types"
import { countdownStartSeconds, nowFor } from "./timing"

// estimated time until the person finishes (from the project proposal)
// average workout length minus how long the current session has gone, never below 0
// null when the machine is AVAILABLE, has no session start, or theres no history (avg <= 0)
export function estimateRemainingSeconds(
  machine: Pick<Machine, "state" | "sessionStartedAt" | "timing">,
  avgWorkoutSeconds: number,
  now: Date,
): number | null {
  if (machine.state === "AVAILABLE" || !machine.sessionStartedAt) return null
  if (!(avgWorkoutSeconds > 0)) return null
  const elapsed = (nowFor(machine, now).getTime() - Date.parse(machine.sessionStartedAt)) / 1000
  return Math.max(0, Math.round(avgWorkoutSeconds - elapsed))
}

// seconds since the current session started, or null when not in use
export function currentSessionSeconds(machine: Pick<Machine, "sessionStartedAt" | "timing">, now: Date): number | null {
  if (!machine.sessionStartedAt) return null
  return Math.max(0, (nowFor(machine, now).getTime() - Date.parse(machine.sessionStartedAt)) / 1000)
}

// RESTING only: seconds until it turns AVAILABLE if nobody touches it
// aka the timeout minus time since movement stopped (for a real node the firmwares timeout minus its resting delay)
// it resets by itself when the machine goes ACTIVE again because since moves forward
export function restingCountdownSeconds(
  machine: Pick<Machine, "state" | "since"> & { override?: Machine["override"]; timing?: Machine["timing"] },
  now: Date,
): number | null {
  // held by an admin = pinned, so no countdown
  if (machine.state !== "RESTING" || machine.override?.mode === "hold") return null
  const elapsed = (nowFor(machine, now).getTime() - Date.parse(machine.since)) / 1000
  return Math.max(0, Math.ceil(countdownStartSeconds(machine) - elapsed))
}
