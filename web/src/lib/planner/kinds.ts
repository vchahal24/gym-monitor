// PLANNER KINDS AND UNITS
// Purpose: builds the kinds the planner offers and picks which unit of a kind to suggest

import { GYM_LAYOUT, KIND_LABELS, type machineLayout } from "../../config/gym-layout"
import type { KindAvailability, Machine, MachineGroup, MachineKind } from "../../types"
import { countsForLiveStats, isFreeNow } from "../eligibility"
import type { plannerKind, plannerUnit, slotScoreType, unitSuggestion } from "./types"

// 7 x 7 grid of zeros, for a kind or unit with no history yet
function emptyGrid() {
  return Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 0))
}

// which units are in service and reporting, and which are free now (see liveUnitSets)
export interface liveUnits {
  available: ReadonlySet<string>
  freeNow: ReadonlySet<string>
}

// live unit sets from the machine list, by the rules in src/lib/eligibility.ts
export function liveUnitSets(machines: readonly Machine[]): liveUnits {
  return {
    available: new Set(machines.filter(countsForLiveStats).map((m) => m.id)),
    freeNow: new Set(machines.filter(isFreeNow).map((m) => m.id)),
  }
}

export interface kindInputs {
  live: liveUnits // maintenance / offline decide which units we can offer
  availability: readonly KindAvailability[] // from GET /api/kinds/availability
  unitOccupancy: ReadonlyMap<string, number[][]> // each units 4 week [day][block] heatmap values
  avgWorkout: ReadonlyMap<string, number>
  layout?: readonly machineLayout[]
}

// builds the planners kinds from the live machines and the history
// which units are available always follows the live machines
// so a unit that just broke or went offline is never offered, even before the history gets refetched
export function buildPlannerKinds({ live, availability, unitOccupancy, avgWorkout, layout = GYM_LAYOUT }: kindInputs): plannerKind[] {
  const avail = new Map(availability.map((a) => [a.kind, a]))
  const order: MachineKind[] = []
  const byKind = new Map<MachineKind, machineLayout[]>()
  for (const l of layout) {
    if (!byKind.has(l.kind)) order.push(l.kind)
    byKind.set(l.kind, [...(byKind.get(l.kind) ?? []), l])
  }
  return order.map((kind) => {
    const ls = byKind.get(kind)!
    const units: plannerUnit[] = ls.map((l) => ({
      id: l.id,
      name: l.name,
      occupancy: unitOccupancy.get(l.id) ?? emptyGrid(),
      x: l.x,
      y: l.y,
      available: live.available.has(l.id),
      freeNow: live.available.has(l.id) && live.freeNow.has(l.id),
    }))
    const a = avail.get(kind)
    const works = ls.map((l) => avgWorkout.get(l.id) ?? 0).filter((s) => s > 0)
    return {
      id: kind,
      name: KIND_LABELS[kind],
      group: ls[0].group as MachineGroup,
      units,
      pFree: a?.pAnyFree ?? emptyGrid(),
      typicalFree: a?.typicalFree ?? emptyGrid(),
      avgWorkoutSeconds: works.length ? works.reduce((x, y) => x + y, 0) / works.length : 0,
      operational: units.some((u) => u.available),
      ...(a?.collectingData ? { collectingData: true } : {}),
    }
  })
}

// the units of a kind we can offer, aka in service and reporting
export function availableUnits(kind: plannerKind): plannerUnit[] {
  return kind.units.filter((u) => u.available)
}

// for example "Treadmill ×4 (3 in service)" or "Pec deck ×1 · Out of service"
export function kindPickerLabel(kind: plannerKind): { label: string; detail: string | null; disabled: boolean } {
  const n = kind.units.length
  const k = availableUnits(kind).length
  const label = `${kind.name} ×${n}`
  if (k === 0) return { label, detail: "Out of service", disabled: true }
  if (kind.collectingData) return { label, detail: "live sensor · not enough data yet", disabled: false }
  return { label, detail: k < n ? `${k} in service` : null, disabled: false }
}

const TIE = 0.01 // occupancies closer than 1 point count as a tie

// average, 0 for an empty list
function mean(xs: readonly number[]): number {
  if (!xs.length) return 0
  let tot = 0
  for (const x of xs) tot += x
  return tot / xs.length
}

// a units occupancy averaged over the slots blocks
export function unitOccupancyIn(unit: plannerUnit, slot: Pick<slotScoreType, "day" | "block" | "blocks">): number {
  return mean(Array.from({ length: slot.blocks }, (_, i) => unit.occupancy[slot.day][slot.block + i]))
}

// middle of the in service units of the OTHER kinds in the workout, null if there arent any
function anchorFor(kind: plannerKind, workout: readonly plannerKind[]): { x: number; y: number } | null {
  const pts = workout.filter((k) => k.id !== kind.id).flatMap(availableUnits)
  if (pts.length === 0) return null
  return { x: mean(pts.map((p) => p.x)), y: mean(pts.map((p) => p.y)) }
}

// straight line distance on the floor plan, 0 when theres nothing to measure from
function distance(u: plannerUnit, p: { x: number; y: number } | null): number {
  return p ? Math.hypot(u.x - p.x, u.y - p.y) : 0
}

// quietest first, near ties go to the closest one
function rankUnits(units: readonly plannerUnit[], slot: Pick<slotScoreType, "day" | "block" | "blocks">, anchor: { x: number; y: number } | null) {
  return units
    .map((u) => ({ u, occ: unitOccupancyIn(u, slot), dist: distance(u, anchor) }))
    .sort((a, b) => (Math.abs(a.occ - b.occ) > TIE ? a.occ - b.occ : a.dist - b.dist || a.u.id.localeCompare(b.u.id)))
}

// the unit to suggest for a kind in a slot
// the in service unit with the lowest occupancy then, near ties (within 1 point) go to the one
// nearest the workouts other machines on the floor plan
// with live, if that one is busy right now we swap it for a free unit (if theres one)
export function suggestUnit(
  kind: plannerKind,
  slot: Pick<slotScoreType, "day" | "block" | "blocks">,
  workout: readonly plannerKind[] = [],
  live = false,
): unitSuggestion {
  const ranked = rankUnits(availableUnits(kind), slot, anchorFor(kind, workout))
  if (ranked.length === 0) return { kind: kind.id, unitId: null, occupancy: 1 }
  const first = ranked[0]
  if (live && !first.u.freeNow) {
    const free = ranked.find((r) => r.u.freeNow)
    if (free) return { kind: kind.id, unitId: free.u.id, occupancy: free.occ, swappedLive: true }
  }
  return { kind: kind.id, unitId: first.u.id, occupancy: first.occ }
}

// suggestions for every kind in a workout slot
export function suggestUnits(workout: readonly plannerKind[], slot: Pick<slotScoreType, "day" | "block" | "blocks">, live = false): unitSuggestion[] {
  return workout.map((k) => suggestUnit(k, slot, workout, live))
}

export interface kindLiveType {
  kind: plannerKind
  inService: plannerUnit[] // in service and reporting
  free: plannerUnit[] // the ones of those that are free right now
}

// whats behind "Treadmill: 2 of 3 in service free now (TM02, TM04)"
export function kindLive(kind: plannerKind): kindLiveType {
  const inService = availableUnits(kind)
  return { kind, inService, free: inService.filter((u) => u.freeNow) }
}
