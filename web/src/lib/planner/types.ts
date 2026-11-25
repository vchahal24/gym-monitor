// PLANNER TYPES
// Purpose: the shapes the planner works with, kinds, their units and scored slots

import type { MachineGroup, MachineKind } from "../../types"

// one physical machine of a kind, as the planner sees it
export interface plannerUnit {
  id: string
  name: string
  occupancy: number[][] // [day][block] 0..1 from this units 4 week heatmap
  // floor plan position, used for "nearest to your other machines"
  x: number
  y: number
  available: boolean // in service and reporting now, the only units we ever suggest
  freeNow: boolean
}

// one machine kind (for example "Treadmill"), this is what users pick
// blocks are scored on pFree = pAnyFree, the chance at least one in service unit is free
// so kinds with more units do better, and the unit itself gets suggested separately
export interface plannerKind {
  id: MachineKind // for example "treadmill"
  name: string // for example "Treadmill"
  group: MachineGroup
  units: plannerUnit[] // every unit in floor order, unavailable ones included (flagged)
  pFree: number[][] // pAnyFree[day][block] over the in service units, day 0 = Monday
  typicalFree: number[][] // [day][block] average number of units free
  avgWorkoutSeconds: number // average session length on this kind, 0 if unknown
  // false when every unit is in maintenance or offline
  // aka shown as "Out of service" and swapped out of plans
  operational: boolean
}

export interface plannerData {
  kinds: plannerKind[]
  gymOccupancy: number[][] // whole gym [day][block] 0..1, for the crowding part of the score
}

export interface substitution {
  originalId: MachineKind // the kind that was asked for
  substituteId: MachineKind | null // null if nothing else in the group had a unit in service
}

// the unit suggested for one kind in one slot
export interface unitSuggestion {
  kind: MachineKind
  unitId: string | null // null if no unit of the kind is in service
  occupancy: number // the units own occupancy over the slot, lower = quieter
  swappedLive?: boolean // the first pick was busy right now so this free one replaced it
}

export interface slotScoreType {
  day: number
  block: number // first block
  blocks: number // how many 2 hour blocks in a row the workout needs
  score: number // 0..1, higher is better
  mean: number // average pAnyFree of the picked kinds
  min: number // the weakest link
  gymOccupancy: number // whole gym at that time
  // per kind, pFree = pAnyFree over the slot and typicalFree = average units free
  perMachine: { id: MachineKind; pFree: number; typicalFree: number }[]
}
