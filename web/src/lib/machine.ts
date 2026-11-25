// MACHINE SNAPSHOTS
// Purpose: builds the live machine objects from the event log, the same way the backend will

// types, layout + helpers
import type { Machine, machineOverride, Maintenance, StateEvent } from "../types"
import { zoneOf, type machineLayout } from "../config/gym-layout"
import { groupByMachine } from "./intervals"

// the display rules live in eligibility.ts, re exported here so old imports still work
export { displayStatus, isInService as isOperational } from "./eligibility"

// applies one state event to a machine, same update the backend does when a packet arrives
export function applyEvent(machine: Machine, event: StateEvent): Machine {
  if (event.machineId !== machine.id || event.state === machine.state) return machine
  let sessionStartedAt = machine.sessionStartedAt
  if (event.state === "AVAILABLE") sessionStartedAt = null
  else if (machine.state === "AVAILABLE" || !sessionStartedAt) sessionStartedAt = event.timestamp
  return { ...machine, state: event.state, since: event.timestamp, sessionStartedAt }
}

export interface machineExtras {
  online?: boolean
  lastHeartbeat?: string | null
  maintenance?: Maintenance | null
  override?: machineOverride | null
}

// rebuilds every machine from the layout and the whole event log
// a machine with no events is AVAILABLE since fallbackSince
export function machinesFromEvents(
  layout: readonly machineLayout[],
  events: readonly StateEvent[],
  fallbackSince: string,
  extras: (id: string) => machineExtras = () => ({}),
): Machine[] {
  const grouped = groupByMachine(events)
  return layout.map((l) => {
    const x = extras(l.id)
    let m: Machine = {
      id: l.id,
      name: l.name,
      zoneId: zoneOf(l),
      group: l.group,
      kind: l.kind,
      state: "AVAILABLE",
      since: fallbackSince,
      sessionStartedAt: null,
      maintenance: x.maintenance ?? null,
      override: x.override ?? null,
      online: x.online ?? true,
      lastHeartbeat: x.lastHeartbeat ?? null,
      ...(l.prototype ? { prototype: true } : {}),
    }
    for (const e of grouped.get(l.id) ?? []) m = applyEvent(m, e)
    return m
  })
}
