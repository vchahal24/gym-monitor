// KIND AVAILABILITY
// Purpose: for each machine kind, how often at least one unit was free (the planners pFree)

import type { KindAvailability, MachineKind, StateEvent } from "../types"
import { buildOccupancyGrid, GRID_EXCLUDED, GRID_FREE } from "./admin"
import type { downtimeWindow } from "./maintenance"
import { BLOCKS, DAY_LABELS, addDays, startOfDay } from "./time"

export interface kindUnits {
  kind: MachineKind
  units: readonly string[] // the kinds in service units (rules in eligibility.ts)
}

// worked out minute by minute from the history
// we cant just multiply the per unit odds because units arent independent, a rush fills them all at once
//
// every minute of the 7 am - 9 pm blocks over the last weeks x 7 days, each unit is
// free, in use, or excluded (maintenance / offline at that minute)
// minutes where no unit counts are skipped
//   1. pAnyFree = share of counted minutes with at least one unit free
//   2. typicalFree = average number of units free over the counted minutes
export function computeKindAvailability(
  events: readonly StateEvent[],
  kinds: readonly kindUnits[],
  now: Date,
  weeks = 4,
  exclusions: readonly downtimeWindow[] = [],
): KindAvailability[] {
  const from = addDays(startOfDay(now), -(weeks * 7 - 1)).getTime()
  const ids = kinds.flatMap((k) => k.units)
  const grid = buildOccupancyGrid(events, ids, exclusions, from, now.getTime())
  function empty() {
    return DAY_LABELS.map(() => BLOCKS.map(() => 0))
  }

  return kinds.map(({ kind, units }) => {
    const arrs = units.map((id) => grid.status.get(id)!).filter(Boolean)
    const counted = empty()
    const anyFree = empty()
    const freeSum = empty()
    for (let i = 0; i < grid.minutes; i++) {
      const c = grid.cell[i]
      if (c < 0) continue
      let n = 0
      let free = 0
      for (const a of arrs) {
        if (a[i] === GRID_EXCLUDED) continue
        n++
        if (a[i] === GRID_FREE) free++
      }
      if (n === 0) continue
      const d = Math.floor(c / 7)
      const b = c % 7
      counted[d][b]++
      freeSum[d][b] += free
      if (free > 0) anyFree[d][b]++
    }
    function ratio(num: number[][]) {
      return num.map((row, d) => row.map((v, b) => (counted[d][b] ? round3(v / counted[d][b]) : 0)))
    }
    return { kind, units: [...units], pAnyFree: ratio(anyFree), typicalFree: ratio(freeSum) }
  })
}

// 3 decimal places, keeps the API payload small
function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}
