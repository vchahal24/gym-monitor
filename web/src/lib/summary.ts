// GYM SUMMARY
// Purpose: the numbers on the summary cards, live counts plus todays sessions and busiest block

import type { Machine, Session, StateEvent, Summary } from "../types"
import { liveCounts } from "./eligibility"
import { eventsToIntervals, isInUse } from "./intervals"
import { downtimeMs, subtractDowntime, type downtimeWindow } from "./maintenance"
import { averageWorkoutSeconds } from "./sessions"
import { BLOCKS, blockRange, overlap, startOfDay } from "./time"

// share of reporting machines in use right now (ACTIVE or RESTING)
// offline ones are out of both sides because we dont know their state
// and maintenance ones because nobody can use them
export function computeUtilisation(machines: readonly Machine[]): number {
  return liveCounts(machines).utilisation
}

// the gym summary, sessionsToday = finished sessions that started today (local time)
export function computeSummary(machines: readonly Machine[], sessionsToday: readonly Session[]): Summary {
  const c = liveCounts(machines)
  return {
    total: c.total,
    operational: c.operational,
    reporting: c.reporting,
    offline: c.offline,
    available: c.available,
    active: c.active,
    resting: c.resting,
    maintenance: c.maintenance,
    utilisation: c.utilisation,
    avgWorkoutSecondsToday: Math.round(averageWorkoutSeconds(sessionsToday)),
    sessionsToday: sessionsToday.length,
  }
}

// sessions that started today, local time
export function sessionsStartedToday(sessions: readonly Session[], now: Date): Session[] {
  const start = startOfDay(now).getTime()
  return sessions.filter((s) => Date.parse(s.start) >= start)
}

export interface busiestTodayType {
  block: string
  value: number // share of machine time in use over the part of the block thats happened
}

// busiest 2 hour block so far today across the machines
// null if no block has started yet or nothing was used
export function busiestBlockToday(
  events: readonly StateEvent[],
  machineIDs: readonly string[],
  now: Date,
  // maintenance / offline time, taken out of both the time used and the time available
  exclusions: readonly downtimeWindow[] = [],
): busiestTodayType | null {
  const nowMs = now.getTime()
  const dayStart = startOfDay(now).getTime()
  const ids = new Set(machineIDs)
  const excl = exclusions.filter((w) => ids.has(w.machineId))
  const intervals = subtractDowntime(
    eventsToIntervals(
      events.filter((e) => ids.has(e.machineId)),
      nowMs,
      dayStart,
    ).filter((iv) => isInUse(iv.state)),
    excl,
  )

  let best: busiestTodayType | null = null
  for (let b = 0; b < BLOCKS.length; b++) {
    const [bs, be] = blockRange(now, b)
    const span = overlap(bs, be, dayStart, nowMs)
    if (span <= 0) continue
    let used = 0
    for (const iv of intervals) used += overlap(bs, Math.min(be, nowMs), iv.start, iv.end)
    const total = span * ids.size - downtimeMs(excl, Math.max(bs, dayStart), Math.min(be, nowMs))
    if (total <= 0) continue
    const value = used / total
    if (value > 0 && (!best || value > best.value)) best = { block: BLOCKS[b].label, value }
  }
  return best
}
