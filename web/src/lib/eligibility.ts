// ELIGIBILITY RULES
// Purpose: the one place that decides what a machine shows and whether it counts for live and history figures

import type { DisplayStatus, Machine, maintenanceRecord, offlineRecord } from "../types"
import { isInUse } from "./intervals"
import type { downtimeWindow } from "./maintenance"

// rules for which machines count towards which numbers
// every live figure (available, in use, utilisation, planner live status) and every
// history figure (heatmaps, utilisation, saturation) goes through these
//   1. MAINTENANCE (admin flag): nobody can use it, so its out of live stats and its time is out of history
//   2. OFFLINE (no packet or heartbeat for > 90 s): we dont know its live state
//      so its out of live stats (top AND bottom of the fraction) and its time is out of history,
//      same as maintenance, never counted as 0 % or 100 %
// what gets shown: MAINTENANCE beats OFFLINE beats the sensor state

type liveFields = Pick<Machine, "state" | "maintenance" | "online">

// what the UI shows for a machine
export function displayStatus(m: liveFields): DisplayStatus {
  if (m.maintenance) return "MAINTENANCE"
  if (!m.online) return "OFFLINE"
  return m.state
}

// not in maintenance (it can be used, whether or not its node is reporting)
export function isInService(m: Pick<Machine, "maintenance">): boolean {
  return m.maintenance === null
}

// in service and its node is reporting, so its live state is known
export function countsForLiveStats(m: Pick<Machine, "maintenance" | "online">): boolean {
  return isInService(m) && m.online
}

// known to be free right now
export function isFreeNow(m: liveFields): boolean {
  return countsForLiveStats(m) && m.state === "AVAILABLE"
}

// known to be taken right now (ACTIVE or RESTING)
export function isBusyNow(m: liveFields): boolean {
  return countsForLiveStats(m) && isInUse(m.state)
}

export interface liveCountsType {
  total: number
  operational: number // not in maintenance
  reporting: number // operational and online, every live figure is out of this
  offline: number // operational but not reporting
  maintenance: number
  available: number
  active: number
  resting: number
  inUse: number
  utilisation: number // inUse / reporting, 0 when nothing reports
}

// live counts over any set of machines (the gym, a zone, a kind)
export function liveCounts(machines: readonly liveFields[]): liveCountsType {
  let operational = 0
  let reporting = 0
  let available = 0
  let active = 0
  let resting = 0
  for (const m of machines) {
    if (!isInService(m)) continue
    operational++
    if (!countsForLiveStats(m)) continue
    reporting++
    if (m.state === "AVAILABLE") available++
    else if (m.state === "ACTIVE") active++
    else resting++
  }
  const inUse = active + resting
  return {
    total: machines.length,
    operational,
    reporting,
    offline: operational - reporting,
    maintenance: machines.length - operational,
    available,
    active,
    resting,
    inUse,
    utilisation: reporting ? inUse / reporting : 0,
  }
}

// for example "26 of 31 reporting · 2 in maintenance · 3 offline", parts that are 0 get left out
export function reportingLine(c: Pick<liveCountsType, "total" | "reporting" | "maintenance" | "offline">): string {
  const parts = [`${c.reporting} of ${c.total} reporting`]
  if (c.maintenance) parts.push(`${c.maintenance} in maintenance`)
  if (c.offline) parts.push(`${c.offline} offline`)
  return parts.join(" · ")
}

// ---------------- HISTORY ----------------

// windows (epoch ms) where a machines time doesnt count towards history, aka maintenance and offline spells
// records that are still open (end is null) run up to now
export function historyExclusions(
  machineId: string,
  maintenance: readonly maintenanceRecord[],
  offline: readonly offlineRecord[],
  now: number,
): downtimeWindow[] {
  // one record -> one window
  function win(since: string, end: string | null, reason: downtimeWindow["reason"]): downtimeWindow {
    return {
      machineId,
      start: Date.parse(since),
      end: end ? Date.parse(end) : now,
      reason,
    }
  }
  return [...maintenance.map((r) => win(r.since, r.end, "maintenance")), ...offline.map((r) => win(r.since, r.end, "offline"))].filter((w) => w.end > w.start)
}

// true if the machines time at t counts towards heatmaps and utilisation
export function countsForHistory(machine: { id: string }, t: number, exclusions: readonly downtimeWindow[]): boolean {
  return !exclusions.some((w) => w.machineId === machine.id && t >= w.start && t < w.end)
}

// exclusions we can tell from the live machine list alone
// the current maintenance (since maintenance.since) and the current offline spell (since the last heartbeat)
// used for the today figures we work out in the browser
export function currentExclusions(machines: readonly Machine[], now: number): downtimeWindow[] {
  const out: downtimeWindow[] = []
  for (const m of machines) {
    if (m.maintenance) out.push({ machineId: m.id, start: Date.parse(m.maintenance.since), end: now, reason: "maintenance" })
    else if (!m.online && m.lastHeartbeat) out.push({ machineId: m.id, start: Date.parse(m.lastHeartbeat), end: now, reason: "offline" })
  }
  return out.filter((w) => w.end > w.start)
}
