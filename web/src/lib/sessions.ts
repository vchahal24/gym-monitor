// SESSIONS FROM EVENTS
// Purpose: finds the finished sessions in the event stream, the same way the backend will

import type { MachineState, Session, StateEvent } from "../types"
import { groupByMachine } from "./intervals"

// a session runs from AVAILABLE -> ACTIVE to RESTING -> AVAILABLE
// each one gets two lengths:
//   1. workoutSeconds = start to the end of the last ACTIVE bit, this is the "session length" users see
//   2. occupiedSeconds = start to end including the final resting timeout, because the machine looked taken
//      utilisation and heatmaps use this one
//
// ASSUMPTION: if a machines first event is ACTIVE we treat the state before it as AVAILABLE
// if its RESTING we dont know when the session started so we skip it
// sessions still open at the end of the stream arent returned
export function deriveSessions(events: readonly StateEvent[]): Session[] {
  const out: Session[] = []
  for (const [machineId, list] of groupByMachine(events)) {
    let open: { start: number; active: number; resting: number; lastActiveEnd: number } | null = null
    let prev: { state: MachineState; t: number } | null = null

    for (const ev of list) {
      const t = Date.parse(ev.timestamp)
      if (prev && prev.state === ev.state) continue

      if (open && prev) {
        const dt = (t - prev.t) / 1000
        if (prev.state === "ACTIVE") {
          open.active += dt
          open.lastActiveEnd = t
        } else if (prev.state === "RESTING") open.resting += dt
      }

      if (ev.state === "ACTIVE" && !open && (prev === null || prev.state === "AVAILABLE")) {
        open = { start: t, active: 0, resting: 0, lastActiveEnd: t }
      } else if (ev.state === "AVAILABLE" && open) {
        out.push({
          machineId,
          start: new Date(open.start).toISOString(),
          lastActiveEnd: new Date(open.lastActiveEnd).toISOString(),
          end: new Date(t).toISOString(),
          workoutSeconds: Math.round((open.lastActiveEnd - open.start) / 1000),
          occupiedSeconds: Math.round((t - open.start) / 1000),
          activeSeconds: Math.round(open.active),
          restingSeconds: Math.round(open.resting),
        })
        open = null
      }
      prev = { state: ev.state, t }
    }
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

// average workout length (the "session length") in seconds, 0 if there are none
export function averageWorkoutSeconds(sessions: readonly Session[]): number {
  if (sessions.length === 0) return 0
  let tot = 0
  for (const s of sessions) tot += s.workoutSeconds
  return tot / sessions.length
}

// average occupied time including the final timeout, in seconds, 0 if none
export function averageOccupiedSeconds(sessions: readonly Session[]): number {
  if (sessions.length === 0) return 0
  let tot = 0
  for (const s of sessions) tot += s.occupiedSeconds
  return tot / sessions.length
}

// middle value, or the average of the two middle ones, 0 for an empty list
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
