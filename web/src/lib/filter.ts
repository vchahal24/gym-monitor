// MAP AND LIST FILTERS
// Purpose: decides which machines show up for the status and group chips on the gym floor

// types + the display status rule
import type { DisplayStatus, Machine, MachineGroup } from "../types"
import { displayStatus } from "./machine"

export interface filterValue {
  statuses: DisplayStatus[]
  groups: MachineGroup[]
}

export const EMPTY_FILTER: filterValue = { statuses: [], groups: [] }

// empty lists mean no restriction, so nothing picked = show everything
export function matchesFilter(m: Machine, f: filterValue): boolean {
  const statusOk = f.statuses.length === 0 || f.statuses.includes(displayStatus(m))
  return statusOk && (f.groups.length === 0 || f.groups.includes(m.group))
}
