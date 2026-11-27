// WEEKLY HEATMAP
// Purpose: the day x block grid of how busy a machine (or the whole gym) usually is

import type { Heatmap, StateEvent } from "../types"
import { eventsToIntervals, isInUse } from "./intervals"
import { downtimeMs, subtractDowntime, type downtimeWindow } from "./maintenance"
import { BLOCKS, DAY_LABELS, addDays, blockRange, mondayIndex, overlap, startOfDay } from "./time"

export interface heatmapOptions {
  machineId: string | "ALL" // one machine, or ALL to average over machineIds
  machineIds: readonly string[] // whats in the average, just the one machine for a single machine
  now: Date
  weeks: number
  // maintenance / offline time, out of both the time used and the time available
  downtime?: readonly downtimeWindow[]
  // also return coverage, the share of each block that had data (used for real nodes that are still collecting)
  withCoverage?: boolean
}

// for each weekday x 2 hour block, the share of it the machine(s) were in use, averaged over the last few weeks
// the window is the last weeks x 7 days up to now (today included), so every weekday shows up weeks times
// only time thats already happened counts, the rest of the current block isnt treated as idle
export function computeHeatmap(events: readonly StateEvent[], opts: heatmapOptions): Heatmap {
  const { machineIds: machineIDs, now, weeks } = opts
  const nowMs = now.getTime()
  const today = startOfDay(now)
  const firstDay = addDays(today, -(weeks * 7 - 1))
  const windowStart = firstDay.getTime()
  const ids = new Set(machineIDs)
  const downtime = (opts.downtime ?? []).filter((w) => ids.has(w.machineId))

  const used = DAY_LABELS.map(() => BLOCKS.map(() => 0))
  const total = DAY_LABELS.map(() => BLOCKS.map(() => 0))
  const possible = DAY_LABELS.map(() => BLOCKS.map(() => 0))

  const relevant = events.filter((e) => ids.has(e.machineId))
  const intervals = subtractDowntime(
    eventsToIntervals(relevant, nowMs, windowStart).filter((iv) => isInUse(iv.state)),
    downtime,
  )

  // in use intervals by calendar day so each block only looks at its own day
  const byDay = new Map<number, typeof intervals>()
  for (const iv of intervals) {
    for (let d = startOfDay(new Date(iv.start)); d.getTime() < iv.end; d = addDays(d, 1)) {
      const key = d.getTime()
      let list = byDay.get(key)
      if (!list) byDay.set(key, (list = []))
      list.push(iv)
    }
  }

  for (let d = firstDay; d.getTime() <= today.getTime(); d = addDays(d, 1)) {
    const dow = mondayIndex(d)
    const dayIntervals = byDay.get(d.getTime()) ?? []
    for (let b = 0; b < BLOCKS.length; b++) {
      const [bs, be] = blockRange(d, b)
      const span = overlap(bs, be, windowStart, nowMs)
      if (span <= 0) continue
      possible[dow][b] += span * ids.size
      total[dow][b] += span * ids.size - downtimeMs(downtime, Math.max(bs, windowStart), Math.min(be, nowMs))
      for (const iv of dayIntervals) used[dow][b] += overlap(bs, Math.min(be, nowMs), iv.start, iv.end)
    }
  }

  const values = used.map((row, d) => row.map((u, b) => (total[d][b] > 0 ? round3(u / total[d][b]) : 0)))

  let best = { d: 0, b: 0, v: -1 }
  for (let d = 0; d < values.length; d++) {
    for (let b = 0; b < values[d].length; b++) {
      const v = values[d][b]
      if (v > best.v) best = { d, b, v }
    }
  }

  const out: Heatmap = {
    machineId: opts.machineId,
    weeks,
    blocks: BLOCKS.map((b) => b.label),
    days: [...DAY_LABELS],
    values,
    busiest: { day: DAY_LABELS[best.d], block: BLOCKS[best.b].label, value: Math.max(0, best.v) },
  }
  if (opts.withCoverage) out.coverage = total.map((row, d) => row.map((t, b) => (possible[d][b] > 0 ? round3(t / possible[d][b]) : 0)))
  return out
}

// clamps to 0..1 and rounds to 3 places
function round3(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000
}
