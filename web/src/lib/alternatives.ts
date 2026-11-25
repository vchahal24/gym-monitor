// SAME GROUP ALTERNATIVES
// Purpose: finds other machines a person could use instead, for the machine page and side panel

import type { Machine } from "../types"
import { countsForLiveStats, displayStatus, isFreeNow } from "./eligibility"

export interface alternative {
  machine: Machine
  sameKind: boolean
}

// other machines in the same group that are in service and reporting
// order: same kind first, then free, then resting, then by ID
export function alternativesFor(machine: Machine, machines: readonly Machine[]): alternative[] {
  function rank(m: Machine) {
    if (isFreeNow(m)) return 0
    if (displayStatus(m) === "RESTING") return 1
    return 2
  }
  return machines
    .filter((m) => m.id !== machine.id && m.group === machine.group && countsForLiveStats(m))
    .map((m) => ({ machine: m, sameKind: m.kind === machine.kind }))
    .sort((a, b) => Number(b.sameKind) - Number(a.sameKind) || rank(a.machine) - rank(b.machine) || a.machine.id.localeCompare(b.machine.id))
}

// for example "Seated Leg Press is busy, but Hack Squat is free"
// null when the machine is free or nothing else is
export function alternativeHint(machine: Machine, alternatives: readonly alternative[]): string | null {
  const status = displayStatus(machine)
  if (status === "AVAILABLE") return null
  const free = alternatives.find((a) => isFreeNow(a.machine))
  if (!free) return null
  let why = "is busy"
  if (status === "MAINTENANCE") why = "is out of service"
  else if (status === "OFFLINE") why = "has no live status"
  return `${machine.name} ${why}, but ${free.machine.name} is free`
}
