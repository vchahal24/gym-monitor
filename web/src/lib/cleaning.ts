// CLEANING ANALYTICS
// Purpose: the numbers behind /admin/cleaning
//   1. zone load: sessions and occupied minutes since a zone was last cleaned, from the event stream like every other stat
//   2. expected load: average occupied machine hours per weekday x opening hour over the last 4 weeks, per zone
//   3. schedule: when to send cleaners (the quiet hour right after a rush, or just before the next one),
//      how many cleaner hours, and weekly deep clean slots in the quietest windows

// config + types + interval helpers
import {
  CLEANER_HOURS_MAX,
  CLEANER_HOURS_MIN,
  CLEANER_HOURS_STEP,
  DEEP_CLEAN_HOURS,
  DEEP_CLEANS_PER_WEEK,
  MACHINE_HOURS_PER_CLEANER_HOUR,
  MAX_HOURS_BETWEEN_CLEANS,
  cleaningThreshold,
} from "../config/cleaning"
import { CLOSE_HOUR, OPEN_HOUR, hourLabel } from "../config/gym-hours"
import type { StateEvent, zoneLoad } from "../types"
import { eventsToIntervals, groupByMachine, isInUse } from "./intervals"
import { addDays, mondayIndex, overlap, startOfDay } from "./time"

const HOUR_MS = 3_600_000
// opening hours as columns, CLEAN_HOURS[i] is the hour of column i
export const CLEAN_HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i)

export interface zoneMachine {
  id: string
  zoneId: string
}

// sessions started and occupied minutes in [since, now] for these machines
export function loadSince(events: readonly StateEvent[], ids: ReadonlySet<string>, since: number, now: number): { sessions: number; occupiedMinutes: number } {
  const mine = events.filter((e) => ids.has(e.machineId))
  let sessions = 0
  for (const list of groupByMachine(mine).values()) {
    let prev: string | null = null
    for (const e of list) {
      const t = Date.parse(e.timestamp)
      if (e.state === "ACTIVE" && (prev === null || prev === "AVAILABLE") && t >= since && t <= now) sessions++
      prev = e.state
    }
  }
  let used = 0
  for (const iv of eventsToIntervals(mine, now, since)) {
    if (isInUse(iv.state)) used += iv.end - iv.start
  }
  return { sessions, occupiedMinutes: Math.round(used / 60_000) }
}

// GET /api/admin/zones worked out from events, the mock uses this and the backend should match it
export function zoneLoads(events: readonly StateEvent[], machines: readonly zoneMachine[], lastCleaned: ReadonlyMap<string, number>, now: number): zoneLoad[] {
  const zones = [...new Set(machines.map((m) => m.zoneId))]
  return zones.map((zoneId) => {
    const since = lastCleaned.get(zoneId) ?? now
    const { sessions, occupiedMinutes } = loadSince(events, new Set(machines.filter((m) => m.zoneId === zoneId).map((m) => m.id)), since, now)
    return { zoneId, lastCleaned: new Date(since).toISOString(), sessionsSince: sessions, occupiedMinutesSince: occupiedMinutes }
  })
}

export interface zoneAlertType {
  zoneId: string
  ratio: number // 0 and up, >= 1 means over the threshold
  over: boolean
  reason: "sessions" | "minutes"
}

// how close a zone is to needing a clean (whichever of the two ratios is bigger)
export function zoneAlert(z: zoneLoad): zoneAlertType {
  const t = cleaningThreshold(z.zoneId)
  const rs = z.sessionsSince / t.sessions
  const rm = z.occupiedMinutesSince / t.occupiedMinutes
  return { zoneId: z.zoneId, ratio: Math.max(rs, rm), over: rs >= 1 || rm >= 1, reason: rs >= rm ? "sessions" : "minutes" }
}

// average occupied machine hours per [weekday][opening hour] for each zone
// over the full weeks before today
export function expectedZoneLoad(events: readonly StateEvent[], machines: readonly zoneMachine[], now: Date, weeks = 4): Map<string, number[][]> {
  const end = startOfDay(now).getTime()
  const start = addDays(startOfDay(now), -7 * weeks).getTime()
  const zoneOf = new Map(machines.map((m) => [m.id, m.zoneId]))
  const out = new Map<string, number[][]>()
  for (const z of new Set(machines.map((m) => m.zoneId)))
    out.set(
      z,
      Array.from({ length: 7 }, () => CLEAN_HOURS.map(() => 0)),
    )
  const intervals = eventsToIntervals(events, end, start).filter((iv) => isInUse(iv.state) && zoneOf.has(iv.machineId))
  for (const iv of intervals) {
    const grid = out.get(zoneOf.get(iv.machineId)!)!
    for (let d = startOfDay(new Date(iv.start)); d.getTime() < iv.end; d = addDays(d, 1)) {
      const dow = mondayIndex(d)
      for (let i = 0; i < CLEAN_HOURS.length; i++) {
        const hs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), CLEAN_HOURS[i]).getTime()
        const o = overlap(hs, hs + HOUR_MS, iv.start, iv.end)
        if (o > 0) grid[dow][i] += o / HOUR_MS / weeks
      }
    }
  }
  return out
}

export interface cleanSlot {
  day: number // 0 = Monday
  hour: number
  kind: "after-peak" | "before-peak" | "quiet-gap"
  reason: string
  cleanerHours: number // suggested cleaner hours, in proportion to the load since the last visit
  loadMachineHours: number // occupied machine hours expected since the last visit
  // zones to start with, heaviest first, with their share of the load
  zones: { zoneId: string; share: number }[]
}

export interface deepClean {
  day: number
  hour: number
  hours: number
  load: number // expected machine hours in use during the window, lower is better
}

export interface cleaningPlan {
  grid: number[][] // whole gym expected machine hours per [day][hour column]
  slots: cleanSlot[]
  deep: deepClean[]
}

const BUSY = 0.6 // an hour at >= 60 % of the days peak counts as part of a rush
const MAX_VISITS_PER_DAY = 5

// rounds to the cleaner hours step and keeps it between the min and max
function roundCleaner(h: number): number {
  const r = Math.round(h / CLEANER_HOURS_STEP) * CLEANER_HOURS_STEP
  return Math.min(CLEANER_HOURS_MAX, Math.max(CLEANER_HOURS_MIN, r))
}

// index of the smallest value in [from, to), -1 if theres nothing to pick
function argmin(L: readonly number[], from: number, to: number, skip: (i: number) => boolean = () => false) {
  let best = -1
  for (let i = Math.max(0, from); i < Math.min(L.length, to); i++) if (!skip(i) && (best < 0 || L[i] < L[best])) best = i
  return best
}

// recommended weekly cleaning schedule from the expected load per zone
// for each day:
//   1. a visit in the quietest hour just after each rush (rush = hours in a row at >= 60 % of the days peak)
//   2. one just before each rush when that hour is calmer
//   3. extra visits in the quietest hour of any stretch longer than MAX_HOURS_BETWEEN_CLEANS
// cleaner hours per visit go with the machine hours of use since the last visit
export function cleaningSchedule(byZone: ReadonlyMap<string, number[][]>): cleaningPlan {
  const zones = [...byZone.keys()]
  const grid = Array.from({ length: 7 }, (_, d) => CLEAN_HOURS.map((_, i) => zones.reduce((s, z) => s + byZone.get(z)![d][i], 0)))
  const slots: cleanSlot[] = []

  for (let d = 0; d < 7; d++) {
    const L = grid[d]
    const max = Math.max(...L)
    if (max <= 0) continue
    function busy(i: number) {
      return L[i] >= BUSY * max
    }
    const picks = new Map<number, { kind: cleanSlot["kind"]; reason: string }>()
    for (let i = 0; i < L.length; i++) {
      if (!busy(i) || (i > 0 && busy(i - 1))) continue
      let e = i
      while (e + 1 < L.length && busy(e + 1)) e++
      const rush = `${hourLabel(CLEAN_HOURS[i])}–${hourLabel(CLEAN_HOURS[e] + 1)}`
      const peak = Math.max(...L.slice(i, e + 1))
      // right after the rush, the quietest of the next 3 hours
      const after = argmin(L, e + 1, e + 4)
      if (after >= 0) picks.set(after, { kind: "after-peak", reason: `Quiet spell right after the ${rush} rush` })
      // just before it, if that hour is clearly calmer than the peak
      if (i > 0 && L[i - 1] < 0.75 * peak && !picks.has(i - 1)) picks.set(i - 1, { kind: "before-peak", reason: `Just before the ${rush} rush` })
      i = e
    }
    // fill in long stretches with no visit (opening to closing)
    for (let guard = 0; guard < 10; guard++) {
      const marks = [-1, ...[...picks.keys()].sort((a, b) => a - b), L.length]
      let gap = -1
      for (let k = 1; k < marks.length; k++)
        if (marks[k] - marks[k - 1] > MAX_HOURS_BETWEEN_CLEANS && (gap < 0 || marks[k] - marks[k - 1] > marks[gap] - marks[gap - 1])) gap = k
      if (gap < 0) break
      const lo = marks[gap - 1] + 2
      const hi = marks[gap] - 1
      const q = argmin(L, lo, Math.max(lo + 1, hi), busy)
      const at = q >= 0 ? q : Math.floor((marks[gap - 1] + marks[gap]) / 2)
      picks.set(at, { kind: "quiet-gap", reason: "Quiet hour in a long stretch without a wipe-down" })
    }
    let prev = 0
    const daySlots = [...picks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, p]) => {
        // this zones load since the last visit
        function window(z: string) {
          const rows = byZone.get(z)!
          return rows[d].slice(prev, i).reduce((a, b) => a + b, 0)
        }
        const load = zones.reduce((s, z) => s + window(z), 0)
        const zs = zones
          .map((z) => ({ zoneId: z, share: load > 0 ? window(z) / load : 0 }))
          .filter((z) => z.share > 0.05)
          .sort((a, b) => b.share - a.share)
        prev = i
        return {
          day: d,
          hour: CLEAN_HOURS[i],
          kind: p.kind,
          reason: p.reason,
          loadMachineHours: load,
          cleanerHours: roundCleaner(load / MACHINE_HOURS_PER_CLEANER_HOUR),
          zones: zs,
        }
      })
    // keep the visits with the most load before them
    slots.push(
      ...daySlots
        .sort((a, b) => b.loadMachineHours - a.loadMachineHours)
        .slice(0, MAX_VISITS_PER_DAY)
        .sort((a, b) => a.hour - b.hour),
    )
  }

  // deep cleans go in the quietest DEEP_CLEAN_HOURS long windows, each on a different day
  const windows: deepClean[] = []
  for (let d = 0; d < 7; d++) {
    for (let i = 0; i + DEEP_CLEAN_HOURS <= CLEAN_HOURS.length; i++) {
      windows.push({ day: d, hour: CLEAN_HOURS[i], hours: DEEP_CLEAN_HOURS, load: grid[d].slice(i, i + DEEP_CLEAN_HOURS).reduce((a, b) => a + b, 0) })
    }
  }
  windows.sort((a, b) => a.load - b.load || a.day - b.day || a.hour - b.hour)
  const deep: deepClean[] = []
  for (const w of windows) {
    if (deep.length >= DEEP_CLEANS_PER_WEEK) break
    if (!deep.some((x) => x.day === w.day)) deep.push(w)
  }
  return { grid, slots, deep: deep.sort((a, b) => a.day - b.day) }
}

export type slotStatus = "done" | "now" | "upcoming"

// todays visits and deep cleans, each marked done / now / upcoming
export function todaysCleaning(plan: cleaningPlan, now: Date): { slots: (cleanSlot & { status: slotStatus })[]; deep: (deepClean & { status: slotStatus })[] } {
  const d = mondayIndex(now)
  const h = now.getHours()
  function status(start: number, len: number): slotStatus {
    if (h >= start + len) return "done"
    if (h >= start) return "now"
    return "upcoming"
  }
  return {
    slots: plan.slots.filter((s) => s.day === d).map((s) => ({ ...s, status: status(s.hour, 1) })),
    deep: plan.deep.filter((s) => s.day === d).map((s) => ({ ...s, status: status(s.hour, s.hours) })),
  }
}
