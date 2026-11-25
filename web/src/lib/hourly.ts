// HOURLY OCCUPANCY
// Purpose: the today vs a typical day chart on the machine page, one value per opening hour

import { CLOSE_HOUR, OPEN_HOUR } from "../config/gym-hours"
import type { stateInterval } from "./intervals"
import { downtimeMs, type downtimeWindow } from "./maintenance"
import { addDays, overlap, startOfDay } from "./time"

// every opening hour, 6 am to 11 pm
export const CHART_HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i)

// share of each opening hour on day that the machine was occupied
// null for hours that havent happened yet (after until) or were all downtime
export function hourlyOccupancy(intervals: readonly stateInterval[], machineDowntime: readonly downtimeWindow[], day: Date, until: number): (number | null)[] {
  const d = startOfDay(day)
  return CHART_HOURS.map((h) => {
    const hs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime()
    const he = Math.min(until, hs + 3_600_000)
    if (he <= hs) return null
    const total = he - hs - downtimeMs(machineDowntime, hs, he)
    if (total <= 0) return null
    let used = 0
    for (const iv of intervals) used += overlap(hs, he, iv.start, iv.end)
    return Math.min(1, used / total)
  })
}

// average of the same weekday over the last few weeks, skipping the nulls
export function typicalHourly(intervals: readonly stateInterval[], machineDowntime: readonly downtimeWindow[], now: Date, weeks = 4): (number | null)[] {
  const days = Array.from({ length: weeks }, (_, i) => addDays(startOfDay(now), -7 * (i + 1)))
  const profiles = days.map((d) => hourlyOccupancy(intervals, machineDowntime, d, now.getTime()))
  return CHART_HOURS.map((_, i) => {
    const vals = profiles.map((p) => p[i]).filter((v): v is number => v !== null)
    if (!vals.length) return null
    let tot = 0
    for (const v of vals) tot += v
    return tot / vals.length
  })
}
