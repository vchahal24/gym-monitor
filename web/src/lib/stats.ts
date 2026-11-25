// PER MACHINE STATS
// Purpose: everything the machine page needs about one machine, worked out from its own events

// types + the other lib pieces it builds on
import type { Machine, MachineStats, maintenanceRecord, offlineRecord, StateEvent } from "../types"
import { estimateRemainingSeconds } from "./remaining"
import { averageWorkoutSeconds, deriveSessions, median } from "./sessions"
import { addDays, localDateKey, startOfDay } from "./time"
import { utilisationRates, type fleetUtilisationType } from "./utilisation"
import { historyExclusions } from "./eligibility"

export interface machineStatsOptions {
  historyDays?: number // days of history the average session length uses
  perDayDays?: number // days in sessionsPerDay, today included
  recentCount?: number // how many recent sessions to return
  maintenanceHistory?: readonly maintenanceRecord[]
  offlineHistory?: readonly offlineRecord[] // left out of utilisation, same as maintenance
  // from fleetUtilisation(), it needs every machine so the caller works it out
  fleet?: fleetUtilisationType
}

// stats for one machine from its own event stream
export function computeMachineStats(
  machine: Machine,
  events: readonly StateEvent[],
  now: Date,
  { historyDays = 28, perDayDays = 28, recentCount = 12, maintenanceHistory = [], offlineHistory = [], fleet }: machineStatsOptions = {},
): MachineStats {
  const historyStart = addDays(startOfDay(now), -historyDays).getTime()
  const sessions = deriveSessions(events.filter((e) => e.machineId === machine.id)).filter((s) => Date.parse(s.start) >= historyStart)
  const avg = averageWorkoutSeconds(sessions)

  const counts = new Map<string, number>()
  for (const s of sessions) {
    const key = localDateKey(new Date(s.start))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const sessionsPerDay: MachineStats["sessionsPerDay"] = []
  for (let i = perDayDays - 1; i >= 0; i--) {
    const key = localDateKey(addDays(startOfDay(now), -i))
    sessionsPerDay.push({ date: key, count: counts.get(key) ?? 0 })
  }

  const rates =
    fleet?.rates.get(machine.id) ?? utilisationRates(events, machine.id, now, historyExclusions(machine.id, maintenanceHistory, offlineHistory, now.getTime()))
  return {
    machineId: machine.id,
    utilisation: rates,
    rank: fleet?.rank.get(machine.id) ?? 1,
    groupAvgUtilisation: fleet?.groupAvg.get(machine.group) ?? rates.fourWeeks,
    avgWorkoutSeconds: Math.round(avg),
    medianWorkoutSeconds: Math.round(median(sessions.map((s) => s.workoutSeconds))),
    estimatedRemainingSeconds: machine.maintenance ? null : estimateRemainingSeconds(machine, avg, now),
    sessionsPerDay,
    recentSessions: sessions.slice(-recentCount).reverse(),
    maintenanceHistory: [...maintenanceHistory].sort((a, b) => Date.parse(b.since) - Date.parse(a.since)),
    offlineHistory: [...offlineHistory].sort((a, b) => Date.parse(b.since) - Date.parse(a.since)),
  }
}
