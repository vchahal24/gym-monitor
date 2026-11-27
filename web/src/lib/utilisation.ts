// UTILISATION
// Purpose: how much of its in service opening time each machine was occupied, plus ranks and group averages

import type { StateEvent } from "../types"
import { eventsToIntervals, isInUse, type stateInterval } from "./intervals"
import { downtimeMs, subtractDowntime, type downtimeWindow } from "./maintenance"
import { BLOCKS, addDays, overlap, startOfDay } from "./time"

// measured over the heatmap hours, 7 am - 9 pm, same as the heatmaps
export const OPEN_FROM_HOUR = BLOCKS[0].startHour
export const OPEN_TO_HOUR = BLOCKS[BLOCKS.length - 1].endHour

// in use intervals for one machine in [from, to], downtime cut out
export function inUseIntervals(
  events: readonly StateEvent[],
  machineId: string,
  from: number,
  to: number,
  downtime: readonly downtimeWindow[] = [],
): stateInterval[] {
  const mine = events.filter((e) => e.machineId === machineId)
  return subtractDowntime(
    eventsToIntervals(mine, to, from).filter((iv) => isInUse(iv.state)),
    downtime.filter((w) => w.machineId === machineId),
  )
}

// share of in service opening time (7 am - 9 pm) in [from, to] the machine was occupied
// downtime is out of both sides, null if there was no in service time at all
export function utilisationBetween(intervals: readonly stateInterval[], machineDowntime: readonly downtimeWindow[], from: number, to: number): number | null {
  let used = 0
  let total = 0
  for (let d = startOfDay(new Date(from)); d.getTime() < to; d = addDays(d, 1)) {
    const y = d.getFullYear()
    const m = d.getMonth()
    const day = d.getDate()
    const os = Math.max(from, new Date(y, m, day, OPEN_FROM_HOUR).getTime())
    const oe = Math.min(to, new Date(y, m, day, OPEN_TO_HOUR).getTime())
    if (oe <= os) continue
    total += oe - os - downtimeMs(machineDowntime, os, oe)
    for (const iv of intervals) used += overlap(os, oe, iv.start, iv.end)
  }
  return total > 0 ? Math.min(1, used / total) : null
}

export interface utilisationRatesType {
  today: number
  week: number
  fourWeeks: number
}

// today (since midnight), the last 7 days and the last 28 days
export function utilisationRates(events: readonly StateEvent[], machineId: string, now: Date, downtime: readonly downtimeWindow[] = []): utilisationRatesType {
  const t = now.getTime()
  const today = startOfDay(now).getTime()
  const weekFrom = addDays(startOfDay(now), -6).getTime()
  const fourFrom = addDays(startOfDay(now), -27).getTime()
  const mine = downtime.filter((w) => w.machineId === machineId)
  const intervals = inUseIntervals(events, machineId, fourFrom, t, mine)
  return {
    today: utilisationBetween(intervals, mine, today, t) ?? 0,
    week: utilisationBetween(intervals, mine, weekFrom, t) ?? 0,
    fourWeeks: utilisationBetween(intervals, mine, fourFrom, t) ?? 0,
  }
}

// 1 = busiest, ties share the better rank
export function rankByValue(values: ReadonlyMap<string, number>): Map<string, number> {
  const sorted = [...values.entries()].sort((a, b) => b[1] - a[1])
  const out = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    const [id, v] = sorted[i]
    const prev = i > 0 ? sorted[i - 1] : null
    out.set(id, prev && prev[1] === v ? out.get(prev[0])! : i + 1)
  }
  return out
}

export interface fleetUtilisationType {
  rates: Map<string, utilisationRatesType>
  rank: Map<string, number> // by 4 week utilisation, 1 = busiest
  groupAvg: Map<string, number> // average 4 week utilisation per group
}

// utilisation, rank and group averages for every machine
export function fleetUtilisation(
  events: readonly StateEvent[],
  machines: readonly { id: string; group: string }[],
  now: Date,
  downtime: readonly downtimeWindow[] = [],
): fleetUtilisationType {
  const rates = new Map(machines.map((m) => [m.id, utilisationRates(events, m.id, now, downtime)]))
  const rank = rankByValue(new Map([...rates].map(([id, r]) => [id, r.fourWeeks])))
  const sums = new Map<string, { s: number; n: number }>()
  for (const m of machines) {
    const g = sums.get(m.group) ?? { s: 0, n: 0 }
    g.s += rates.get(m.id)!.fourWeeks
    g.n++
    sums.set(m.group, g)
  }
  return { rates, rank, groupAvg: new Map([...sums].map(([g, { s, n }]) => [g, s / n])) }
}
