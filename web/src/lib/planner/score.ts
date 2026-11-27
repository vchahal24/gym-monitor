// PLANNER SCORING
// Purpose: scores a time slot for a set of machine kinds, swaps out kinds that are out of service

import { SIMILAR_KINDS } from "../../config/gym-layout"
import type { MachineKind } from "../../types"
import type { plannerData, plannerKind, slotScoreType, substitution } from "./types"

export const BLOCK_SECONDS = 2 * 3600
export const CHANGEOVER_SECONDS = 2 * 60 // walking over + setting up the next machine
export const DEFAULT_WORKOUT_SECONDS = 10 * 60 // for a machine with no history yet
export const WEAKEST_LINK_WEIGHT = 0.25 // how much the least free kind drags the score down
export const CROWDING_WEIGHT = 0.1 // how much a busy gym overall drags it down

const BLOCK_COUNT = 7

// average, 0 for an empty list
function avg(xs: readonly number[]): number {
  if (!xs.length) return 0
  let tot = 0
  for (const x of xs) tot += x
  return tot / xs.length
}

// picks the kinds to actually plan with
// a kind with every unit in maintenance or offline gets swapped for another kind in the same group
// that still has a unit in service and isnt already picked
// a similar movement first (for example pec deck -> cable crossover), then the one most often free
export function resolveKinds(
  ids: readonly MachineKind[],
  kinds: readonly plannerKind[],
  similar: Partial<Record<MachineKind, readonly MachineKind[]>> = SIMILAR_KINDS,
): { kinds: plannerKind[]; substitutions: substitution[] } {
  const byID = new Map(kinds.map((k) => [k.id, k]))
  const chosen: plannerKind[] = []
  const substitutions: substitution[] = []
  const taken = new Set<MachineKind>(ids)
  for (const id of ids) {
    const m = byID.get(id)
    if (!m) continue
    if (m.operational) {
      chosen.push(m)
      continue
    }
    const near = similar[id] ?? []
    function closeness(k: plannerKind) {
      return near.includes(k.id) ? near.indexOf(k.id) : near.length
    }
    const sub = kinds
      .filter((c) => c.operational && c.group === m.group && !taken.has(c.id))
      .sort((a, b) => closeness(a) - closeness(b) || avg(b.pFree.flat()) - avg(a.pFree.flat()) || a.id.localeCompare(b.id))[0]
    substitutions.push({ originalId: id, substituteId: sub?.id ?? null })
    if (sub) {
      taken.add(sub.id)
      chosen.push(sub)
    }
  }
  return { kinds: chosen, substitutions }
}

// all the kinds average workout times added up, plus ~2 min for each changeover
export function estimateDurationSeconds(machines: readonly plannerKind[]): number {
  if (machines.length === 0) return 0
  let work = 0
  for (const m of machines) work += m.avgWorkoutSeconds > 0 ? m.avgWorkoutSeconds : DEFAULT_WORKOUT_SECONDS
  return work + CHANGEOVER_SECONDS * (machines.length - 1)
}

// how many 2 hour blocks in a row a workout this long needs
export function blocksNeeded(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / BLOCK_SECONDS))
}

// score for starting the workout at (day, block) and running for blocks blocks
// score = average pAnyFree of the kinds - a penalty for the weakest one - a small crowding part
// null if it would run past 9 pm
export function slotScore(
  machines: readonly plannerKind[],
  data: Pick<plannerData, "gymOccupancy">,
  day: number,
  block: number,
  blocks = 1,
): slotScoreType | null {
  if (machines.length === 0 || block + blocks > BLOCK_COUNT) return null
  const range = Array.from({ length: blocks }, (_, i) => block + i)
  const perMachine = machines.map((m) => ({
    id: m.id,
    pFree: avg(range.map((b) => m.pFree[day][b])),
    typicalFree: avg(range.map((b) => m.typicalFree[day][b])),
    ...(m.collectingData ? { noData: true } : {}),
  }))
  const gymOccupancy = avg(range.map((b) => data.gymOccupancy[day][b]))
  // kinds without enough real data yet dont count, if none have data the quieter gym wins
  const ps = perMachine.filter((p) => !p.noData).map((p) => p.pFree)
  const mean = ps.length ? avg(ps) : 1 - gymOccupancy
  const min = ps.length ? Math.min(...ps) : mean
  const score = mean - WEAKEST_LINK_WEIGHT * (1 - min) - CROWDING_WEIGHT * gymOccupancy
  return { day, block, blocks, score, mean, min, gymOccupancy, perMachine }
}

// suggested order, most contested kind first (lowest chance any unit is free)
// kinds that usually have more units free can wait till later
export function machineOrder(slot: Pick<slotScoreType, "perMachine">): MachineKind[] {
  return [...slot.perMachine].sort((a, b) => Number(!!a.noData) - Number(!!b.noData) || a.pFree - b.pFree || a.typicalFree - b.typicalFree || a.id.localeCompare(b.id)).map((p) => p.id)
}

// the score people see, 0 to 100
export function displayScore(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}
