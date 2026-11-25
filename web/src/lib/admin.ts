// OWNER DASHBOARD ANALYTICS
// Purpose: popularity, saturation, trends, recommendations and CSV for the admin pages
// everything comes from the event stream and the per machine stats so a backend can work out the same numbers

import type { MachineGroup, MachineKind, MachineStats, Session, StateEvent } from "../types"
import { eventsToIntervals, groupByMachine, isInUse } from "./intervals"
import { downtimeMs, downtimeWindows, type downtimeWindow } from "./maintenance"
import { BLOCKS, DAY_LABELS, addDays, blockIndexAt, mondayIndex, startOfDay } from "./time"

export interface machineInfo {
  id: string
  name: string
  group: MachineGroup
  kind: MachineKind
}

const STEP_MS = 60_000
// occupancy grid cell values
export const GRID_FREE = 0
export const GRID_USED = 1
export const GRID_EXCLUDED = 2 // maintenance or offline, the minute doesnt count
const USED = GRID_USED
const DOWN = GRID_EXCLUDED

// minute by minute occupancy grid over [from, to], per machine
// 0 = free, 1 = in use (ACTIVE/RESTING), 2 = excluded (maintenance or offline, see src/lib/eligibility.ts)
// rough but simple, and it makes "were all of these busy at the same time?" cheap to answer
export interface occupancyGrid {
  from: number
  minutes: number
  status: Map<string, Uint8Array>
  cell: Int16Array // per minute day*7 + block, or -1 outside the 7 am - 9 pm blocks
}

export function buildOccupancyGrid(
  events: readonly StateEvent[],
  machineIDs: readonly string[],
  downtime: readonly downtimeWindow[],
  from: number,
  to: number,
): occupancyGrid {
  const minutes = Math.max(0, Math.floor((to - from) / STEP_MS))
  const status = new Map<string, Uint8Array>()
  const grouped = groupByMachine(events)
  function mark(arr: Uint8Array, s: number, e: number, v: number) {
    const a = Math.max(0, Math.floor((s - from) / STEP_MS))
    const b = Math.min(minutes, Math.ceil((e - from) / STEP_MS))
    for (let i = a; i < b; i++) arr[i] = v
  }
  for (const id of machineIDs) {
    const arr = new Uint8Array(minutes)
    for (const iv of eventsToIntervals(grouped.get(id) ?? [], to, from)) if (isInUse(iv.state)) mark(arr, iv.start, iv.end, USED)
    for (const w of downtime) if (w.machineId === id) mark(arr, w.start, w.end, DOWN)
    status.set(id, arr)
  }
  const cell = new Int16Array(minutes)
  for (let i = 0; i < minutes; i++) {
    const t = new Date(from + i * STEP_MS)
    const b = blockIndexAt(t)
    cell[i] = b < 0 ? -1 : mondayIndex(t) * 7 + b
  }
  return { from, minutes, status, cell }
}

// 7 x 7 grid of zeros
function emptyGrid() {
  return DAY_LABELS.map(() => BLOCKS.map(() => 0))
}

// saturation, for each weekday x block the share of time EVERY operational machine in ids was in use at once
// machines in maintenance dont count, and time with none operational gets skipped
export function saturationByBlock(grid: occupancyGrid, ids: readonly string[]): number[][] {
  const sat = emptyGrid()
  const tot = emptyGrid()
  const arrs = ids.map((id) => grid.status.get(id)).filter((a): a is Uint8Array => !!a)
  for (let i = 0; i < grid.minutes; i++) {
    const c = grid.cell[i]
    if (c < 0) continue
    let op = 0
    let busy = 0
    for (const a of arrs) {
      if (a[i] === DOWN) continue
      op++
      if (a[i] === USED) busy++
    }
    if (op === 0) continue
    const d = Math.floor(c / 7)
    const b = c % 7
    tot[d][b]++
    if (busy === op) sat[d][b]++
  }
  return sat.map((row, d) => row.map((v, b) => (tot[d][b] ? v / tot[d][b] : 0)))
}

// saturation pooled over a set of (day, block) cells, weighted by time
export function saturationOver(grid: occupancyGrid, ids: readonly string[], cells: (day: number, block: number) => boolean): number {
  const arrs = ids.map((id) => grid.status.get(id)).filter((a): a is Uint8Array => !!a)
  let sat = 0
  let tot = 0
  for (let i = 0; i < grid.minutes; i++) {
    const c = grid.cell[i]
    if (c < 0 || !cells(Math.floor(c / 7), c % 7)) continue
    let op = 0
    let busy = 0
    for (const a of arrs) {
      if (a[i] === DOWN) continue
      op++
      if (a[i] === USED) busy++
    }
    if (op === 0) continue
    tot++
    if (busy === op) sat++
  }
  return tot ? sat / tot : 0
}

// whole gym utilisation (in use / in service machine time, 7 am - 9 pm) per calendar week, oldest first
export function weeklyTrend(grid: occupancyGrid, now: Date, weeks = 4): { label: string; start: number; utilisation: number }[] {
  const out = []
  const thisWeek = addDays(startOfDay(now), -mondayIndex(now))
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(thisWeek, -7 * w).getTime()
    const end = addDays(thisWeek, -7 * w + 7).getTime()
    let used = 0
    let tot = 0
    const a = Math.max(0, Math.floor((start - grid.from) / STEP_MS))
    const b = Math.min(grid.minutes, Math.floor((end - grid.from) / STEP_MS))
    for (const arr of grid.status.values()) {
      for (let i = a; i < b; i++) {
        if (grid.cell[i] < 0 || arr[i] === DOWN) continue
        tot++
        if (arr[i] === USED) used++
      }
    }
    const label = w === 0 ? "This week" : new Date(start).toLocaleDateString([], { day: "numeric", month: "short" })
    out.push({ label, start, utilisation: tot ? used / tot : 0 })
  }
  return out
}

export interface popularityRow extends machineInfo {
  utilisation: number
  sessions: number
  avgWorkoutSeconds: number
  downtimeHours: number // hours out of service in the last 28 days
  downtimeHoursTotal: number // hours out of service in all the history we have
  rank: number
}

// one row per machine, busiest first
export function popularity(machines: readonly machineInfo[], stats: readonly MachineStats[], now: number): popularityRow[] {
  const byID = new Map(stats.map((s) => [s.machineId, s]))
  const from = now - 28 * 86_400_000
  return machines
    .map((m) => {
      const s = byID.get(m.id)
      const windows = s ? downtimeWindows(m.id, s.maintenanceHistory, now) : []
      return {
        ...m,
        utilisation: s?.utilisation.fourWeeks ?? 0,
        sessions: s?.sessionsPerDay.reduce((a, d) => a + d.count, 0) ?? 0,
        avgWorkoutSeconds: s?.avgWorkoutSeconds ?? 0,
        downtimeHours: downtimeMs(windows, from, now) / 3_600_000,
        downtimeHoursTotal: downtimeMs(windows, 0, now) / 3_600_000,
        rank: s?.rank ?? 0,
      }
    })
    .sort((a, b) => b.utilisation - a.utilisation)
}

// one machine kind across its units, for example "Treadmills: 4 units, 64% average, all 4 busy during 22% of weekday 5–7 pm"
export interface kindRow {
  kind: MachineKind
  units: string[]
  utilisation: number // average 4 week utilisation over the units
  sessions: number
  weekdayEvening: number // share of in service weekday 5-7 pm time when every unit was taken at once
}

// popularity and saturation per kind (every kind, in layout order of its first unit)
export function kindSummary(machines: readonly machineInfo[], rows: readonly popularityRow[], grid: occupancyGrid): kindRow[] {
  const byKind = new Map<MachineKind, string[]>()
  for (const m of machines) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m.id])
  const row = new Map(rows.map((r) => [r.id, r]))
  return [...byKind].map(([kind, units]) => {
    const rs = units.map((id) => row.get(id)).filter((r): r is popularityRow => !!r)
    return {
      kind,
      units,
      utilisation: rs.length ? rs.reduce((s, r) => s + r.utilisation, 0) / rs.length : 0,
      sessions: rs.reduce((s, r) => s + r.sessions, 0),
      weekdayEvening: saturationOver(grid, units, (d, b) => d < 5 && b === 5),
    }
  })
}

export interface recommendation {
  type: "buy" | "replace" | "service"
  machineIds: string[]
  title: string
  detail: string
  value: number // the number its based on (0..1 or hours), for sorting and the CSV
}

export const REC_THRESHOLDS = {
  saturation: 0.5, // every unit of a kind busy at once for at least this share of weekday 5-7 pm
  singleBusy: 0.84, // a kind with one unit, "all busy" just means taken so the bar is higher
  maxBuy: 5, // at most this many buy suggestions, strongest first
  lowUse: 0.2, // used less than this share of opening hours
  downtimeHours: 48, // out of service at least this many hours in 4 weeks, or >= 2 incidents on record
}

// 0.42 -> "42%"
function pct(x: number) {
  return `${Math.round(x * 100)}%`
}

// the weekday 5-7 pm block
function weekdayEvening(d: number, b: number) {
  return d < 5 && b === 5
}

// buy / replace / service suggestions, each one explained with numbers
// buy is based on kind saturation at the weekday 5-7 pm peak, aka how often every unit of the kind was taken at once
// (for a kind with only one unit its just how often it was taken, with a higher bar)
export function recommendations(
  machines: readonly machineInfo[],
  rows: readonly popularityRow[],
  grid: occupancyGrid,
  kindLabel: (k: MachineKind) => string,
  incidents: ReadonlyMap<string, number>,
): recommendation[] {
  const byKind = new Map<MachineKind, machineInfo[]>()
  for (const m of machines) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m])

  const buy: recommendation[] = []
  for (const [kind, list] of byKind) {
    const label = kindLabel(kind).toLowerCase()
    const ids = list.map((m) => m.id)
    const s = saturationOver(grid, ids, weekdayEvening)
    const single = list.length === 1
    if (s < (single ? REC_THRESHOLDS.singleBusy : REC_THRESHOLDS.saturation)) continue
    let all = `All ${list.length} were`
    if (single) all = `${list[0].name} is the only one and was`
    else if (list.length === 2) all = "Both were"
    buy.push({
      type: "buy",
      machineIds: ids,
      title: single ? `Consider a second ${label}` : `Buy another ${label}`,
      detail: `${all} ${single ? "taken" : "busy at once"} during ${pct(s)} of weekday 5–7 pm time (in-service time only).`,
      value: s,
    })
  }

  const replace: recommendation[] = []
  const service: recommendation[] = []
  for (const r of rows) {
    if (r.utilisation < REC_THRESHOLDS.lowUse) {
      replace.push({
        type: "replace",
        machineIds: [r.id],
        title: `Rethink the ${r.name.toLowerCase()}`,
        detail: `${r.name} is used ${pct(r.utilisation)} of the time (${r.sessions} sessions in 4 weeks). Consider replacing or relocating it.`,
        value: r.utilisation,
      })
    }
    const n = incidents.get(r.id) ?? 0
    if (r.downtimeHours >= REC_THRESHOLDS.downtimeHours || (n >= 2 && r.downtimeHours > 0)) {
      service.push({
        type: "service",
        machineIds: [r.id],
        title: `Check the service plan for ${r.name}`,
        detail: `Out of service ${Math.round(r.downtimeHours)} h in the last 4 weeks (${n} incident${n === 1 ? "" : "s"} on record).`,
        value: r.downtimeHours,
      })
    }
  }

  return [
    ...buy.sort((a, b) => b.value - a.value).slice(0, REC_THRESHOLDS.maxBuy),
    ...replace.sort((a, b) => a.value - b.value),
    ...service.sort((a, b) => b.value - a.value),
  ]
}

export interface restInsightsType {
  betweenSets: number // rests between sets (RESTING followed by ACTIVE)
  avgRestSeconds: number
  longShare: number // share of those rests longer than 3 min
  nearTimeoutShare: number // share longer than 4 min (close to the 5 min timeout)
  buckets: { label: string; count: number }[]
  // sessions that ended because a rest ran past the timeout and the person came back later
  sessions: number
}

// how long people rest between sets, from the RESTING -> ACTIVE gaps
export function restInsights(events: readonly StateEvent[], sessions: readonly Session[]): restInsightsType {
  const rests: number[] = []
  for (const list of groupByMachine(events).values()) {
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1].state === "RESTING" && list[i].state === "ACTIVE") {
        const s = (Date.parse(list[i].timestamp) - Date.parse(list[i - 1].timestamp)) / 1000
        if (s >= 5) rests.push(s) // ignore blips under 5 s (seat adjustments)
      }
    }
  }
  const edges = [0, 60, 120, 180, 240, 300]
  const buckets = edges.slice(0, -1).map((lo, i) => ({
    label: `${lo / 60}–${edges[i + 1] / 60} min`,
    count: rests.filter((r) => r >= lo && r < edges[i + 1]).length,
  }))
  const n = rests.length
  return {
    betweenSets: n,
    avgRestSeconds: n ? rests.reduce((a, b) => a + b, 0) / n : 0,
    longShare: n ? rests.filter((r) => r > 180).length / n : 0,
    nearTimeoutShare: n ? rests.filter((r) => r > 240).length / n : 0,
    buckets,
    sessions: sessions.length,
  }
}

// average workout time per group
export function avgWorkoutByGroup(
  sessions: readonly Session[],
  machines: readonly machineInfo[],
): { group: MachineGroup; avgSeconds: number; sessions: number }[] {
  const groupOf = new Map(machines.map((m) => [m.id, m.group]))
  const acc = new Map<MachineGroup, { s: number; n: number }>()
  for (const s of sessions) {
    const g = groupOf.get(s.machineId)
    if (!g) continue
    const a = acc.get(g) ?? { s: 0, n: 0 }
    a.s += s.workoutSeconds
    a.n++
    acc.set(g, a)
  }
  return [...acc].map(([group, { s, n }]) => ({ group, avgSeconds: s / n, sessions: n }))
}

// total completed sessions per day across all machines
export function sessionsPerDayTotal(stats: readonly MachineStats[]): { date: string; count: number }[] {
  const acc = new Map<string, number>()
  for (const s of stats) for (const d of s.sessionsPerDay) acc.set(d.date, (acc.get(d.date) ?? 0) + d.count)
  return [...acc].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }))
}

// RFC 4180 CSV
export function toCSV(rows: readonly (readonly (string | number)[])[]): string {
  // quotes a cell only if it needs it
  function cell(v: string | number) {
    const s = String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
}
