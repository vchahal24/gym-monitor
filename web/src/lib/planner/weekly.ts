// WEEKLY PLANNER
// Purpose: builds 3 alternative weekly plans from the picked kinds, availability and rest days

import type { MachineGroup, MachineKind } from "../../types"
import { BLOCKS, DAY_LABELS } from "../time"
import { suggestUnits } from "./kinds"
import { blocksNeeded, displayScore, estimateDurationSeconds, machineOrder, resolveKinds, slotScore } from "./score"
import type { plannerData, plannerKind, slotScoreType, substitution, unitSuggestion } from "./types"

export interface workoutInput {
  name: string
  kinds: MachineKind[] // machine kinds ("treadmill") not units, the planner picks the unit
}

// a custom rest pattern, the workouts in a cycle with some rest days after each one
// for example A → 0 → B → 2 → C → 1 → D → 0 → (A) is a 7 day cycle
export interface restPattern {
  order: number[] // workout indices in cycle order (each of 0..n-1 once)
  restAfter: number[] // restAfter[i] = rest days after the workout at order[i]
}

export interface weeklyInput {
  workouts: workoutInput[] // 1-7 workouts, each on its own day
  availability: boolean[][] // [day][block], true if they can train then
  minRestDays: number // min rest days between workouts (the week wraps round), ignored with a pattern
  sameTime: boolean // every workout in a plan starts in the same block
  pattern?: restPattern | null
}

// one day of a drifting (not 7 day) cycle laid out on the calendar
export interface calendarDay {
  date: number // local midnight, epoch ms
  workoutIndex: number | null // the workout that day, null for a rest day
  // the slot picked, null on rest days and when nothing available fits
  slot: slotScoreType | null
}

export type strategyType = "quietest" | "consistent" | "spread"

export interface plannedWorkout {
  workoutIndex: number
  name: string
  slot: slotScoreType
  kinds: plannerKind[]
  substitutions: substitution[]
  units: unitSuggestion[] // suggested unit per kind for this slot (quietest, then nearest)
  durationSeconds: number
  order: MachineKind[] // kinds, most contested first
  explanation: string // for example "Your leg machines are free 91% of the time on Mon 7–9 am"
}

export interface Plan {
  strategy: strategyType
  title: string
  summary: string
  workouts: plannedWorkout[] // sorted by day
  score: number // 0-100
  minRest: number // fewest rest days between two workouts (wrapping the week)
  // only for rest pattern plans
  cycle?: {
    days: number
    drift: boolean // the cycle isnt 7 days so it drifts across weeks (see calendar)
    order: number[]
    restAfter: number[]
    startDay?: number // weekday (0 = Mon) the cycle starts on, for 7 day cycles
  }
  calendar?: calendarDay[] // drifting cycles, the next 4 weeks day by day
  missed?: number // workout days in the calendar with no available slot
}

export interface weeklyResult {
  plans: Plan[]
  effectiveMinRest: number // the rest rule actually used (lowered if what they asked for cant fit)
  notes: string[]
  cycleDays?: number // rest pattern cycle length in days, when theres a pattern
}

const STRATEGY_TEXT: Record<strategyType, { title: string; summary: string }> = {
  quietest: { title: "Quietest overall", summary: "Picks the times your machines are most likely to be free." },
  consistent: { title: "Consistent routine", summary: "The same time slot on every workout day, so it’s easy to stick to." },
  spread: { title: "Best spread", summary: "Spaces workouts as evenly as possible across the week while staying quiet." },
}

export const PATTERN_TEXT: Record<strategyType, { title: string; summary: string }> = {
  quietest: { title: "Quietest start day", summary: "Starts your cycle on the day that puts every workout at its quietest time." },
  consistent: { title: "Consistent routine", summary: "Your cycle at one fixed time slot, so it’s easy to stick to." },
  spread: { title: "Another start day", summary: "A different starting weekday that still keeps your machines free." },
}

const GROUP_WORD: Record<MachineGroup, string> = {
  legs: "leg",
  "chest-shoulders-triceps": "chest, shoulders & triceps",
  "back-biceps": "back & biceps",
  cardio: "cardio",
}

// rest days between the workout days once sorted, wrapping Sunday -> Monday
export function restGaps(days: readonly number[]): number[] {
  if (days.length < 2) return []
  const s = [...days].sort((a, b) => a - b)
  return s.map((d, i) => (i === s.length - 1 ? s[0] + 7 - d : s[i + 1] - d) - 1)
}

// the biggest rest rule <= wanted that n workouts in 7 days can actually fit
export function feasibleRest(n: number, wanted: number): number {
  let r = Math.max(0, wanted)
  while (r > 0 && n * (r + 1) > 7) r--
  return r
}

type slotLike = string | { day: number; block: number }

// "day:block", or the key itself if its already one
function slotKey(s: slotLike) {
  return typeof s === "string" ? s : `${s.day}:${s.block}`
}

// how many slots in a arent in b (slots as {day, block} or as keys)
export function slotDifference(a: readonly slotLike[], b: readonly slotLike[]): number {
  const set = new Set(b.map(slotKey))
  return a.filter((s) => !set.has(slotKey(s))).length
}

// the line under each workout, for example "Your leg machines are free 91% of the time on Mon 7–9 am"
function explain(machines: readonly plannerKind[], slot: slotScoreType): string {
  const groups = new Set(machines.map((m) => m.group))
  const who = groups.size === 1 ? `Your ${GROUP_WORD[[...groups][0]]} machines are` : "Your machines are"
  const last = BLOCKS[slot.block + slot.blocks - 1]
  const first = BLOCKS[slot.block]
  const time = slot.blocks === 1 ? first.label.replace("-", "–") : `${hourLabel(first.startHour)}–${hourLabel(last.endHour)}`
  return `${who} free ${Math.round(slot.mean * 100)}% of the time on ${dayName(slot.day)} ${time}`
}

// 17 -> "5 pm"
function hourLabel(h: number): string {
  if (h === 12) return "12 pm"
  if (h > 12) return `${h - 12} pm`
  return `${h} am`
}

// "MON" -> "Mon"
function dayName(d: number): string {
  const l = DAY_LABELS[d]
  return l.charAt(0) + l.slice(1).toLowerCase()
}

export interface preparedType {
  kinds: plannerKind[]
  substitutions: substitution[]
  durationSeconds: number
  blocks: number
  // slots[day][block], null where theyre unavailable or it doesnt fit
  slots: (slotScoreType | null)[][]
  best: (slotScoreType | null)[]
}

export interface candidate {
  // one per workout (min rest / 7 day pattern) or one per occurrence (drifting pattern)
  slots: slotScoreType[]
  workoutOf: number[] // workout index for each slot
  keys: string[] // what each slot is for "differs in >= 2 slots" (day:block, or date:block)
  total: number
  sameTime: boolean
  minRest: number
  evenness: number
  distinctBlocks: number
  missed: number // workout days with no available slot (drifting patterns only)
  startDay?: number
  calendar?: calendarDay[]
}

const MAX_WORKOUTS = 7

// works out the kinds, durations and best slot per (workout, day) for each workout
export function prepareWorkouts(input: weeklyInput, data: plannerData): { workouts: workoutInput[]; prepared: preparedType[]; notes: string[] } {
  const notes: string[] = []
  const workouts = input.workouts.slice(0, MAX_WORKOUTS).filter((w) => w.kinds.length > 0)
  const prepared: preparedType[] = workouts.map((w) => {
    const { kinds: machines, substitutions } = resolveKinds(w.kinds, data.kinds)
    const durationSeconds = estimateDurationSeconds(machines)
    const blocks = blocksNeeded(durationSeconds)
    const slots = Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 7 }, (_, b) => {
        for (let i = 0; i < blocks; i++) if (!input.availability[d]?.[b + i]) return null
        return slotScore(machines, data, d, b, blocks)
      }),
    )
    const best = slots.map((row) => row.reduce<slotScoreType | null>((acc, s) => (s && (!acc || s.score > acc.score) ? s : acc), null))
    return { kinds: machines, substitutions, durationSeconds, blocks, slots, best }
  })

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i]
    for (const s of p.substitutions) notes.push(`${workouts[i].name}: ${substitutionText(s, data.kinds)}`)
    if (p.blocks > 1) notes.push(`${workouts[i].name} takes about ${Math.round(p.durationSeconds / 60)} min, so it's planned across ${p.blocks} blocks.`)
  }
  return { workouts, prepared, notes }
}

// builds 3 alternative weekly plans from different strategies
// each one differs from the earlier ones in at least 2 workout slots where it can
// how the search works:
//   1. the best block per (workout, day) gets worked out once
//   2. then we go through every way of putting the workouts on different days that meets the rest rule
//      (at most 7! = 5040 for 7 workouts), plus a same block version of each for the consistent strategy
// with a rest pattern see generatePatternPlans in ./pattern instead
export function generatePlans(input: weeklyInput, data: plannerData): weeklyResult {
  const { workouts, prepared, notes } = prepareWorkouts(input, data)
  const n = workouts.length
  if (n === 0) return { plans: [], effectiveMinRest: input.minRestDays, notes: ["Add machines to at least one workout."] }

  const effectiveMinRest = feasibleRest(n, input.minRestDays)
  if (effectiveMinRest < input.minRestDays) {
    notes.unshift(
      `${n} workouts don't fit in a week with ${input.minRestDays} rest day${input.minRestDays === 1 ? "" : "s"} between them, so plans use ${effectiveMinRest}.`,
    )
  }
  if (n === 7) notes.unshift(SEVEN_DAY_NOTE)

  // go through every day assignment
  const candidates: candidate[] = []
  const days: number[] = []
  const used = new Set<number>()
  const workoutOf = Array.from({ length: n }, (_, i) => i)
  function keysOf(slots: slotScoreType[]) {
    return slots.map((s) => `${s.day}:${s.block}`)
  }

  // puts workout w on each free day in turn, then the next workout, and so on
  function visit(w: number) {
    if (w === n) {
      const gaps = restGaps(days)
      const minRest = gaps.length ? Math.min(...gaps) : 7
      if (minRest < effectiveMinRest) return
      const ideal = n > 1 ? 7 / n - 1 : 1
      const evenness = n > 1 ? Math.min(1, minRest / Math.max(ideal, 0.0001)) - variance(gaps) * 0.05 : 1
      const free = days.map((d, i) => prepared[i].best[d]!)
      candidates.push({
        slots: free,
        workoutOf,
        keys: keysOf(free),
        total: sum(free.map((s) => s.score)),
        sameTime: free.every((s) => s.block === free[0].block),
        minRest,
        evenness,
        distinctBlocks: new Set(free.map((s) => s.block)).size,
        missed: 0,
      })
      for (let b = 0; b < 7; b++) {
        const same = days.map((d, i) => prepared[i].slots[d][b])
        if (same.some((s) => !s)) continue
        const slots = same as slotScoreType[]
        if (slots.every((s, i) => s.block === free[i].block)) continue // same as the free version
        candidates.push({
          slots,
          workoutOf,
          keys: keysOf(slots),
          total: sum(slots.map((s) => s.score)),
          sameTime: true,
          minRest,
          evenness,
          distinctBlocks: 1,
          missed: 0,
        })
      }
      return
    }
    for (let d = 0; d < 7; d++) {
      if (used.has(d) || !prepared[w].best[d]) continue
      used.add(d)
      days.push(d)
      visit(w + 1)
      days.pop()
      used.delete(d)
    }
  }
  visit(0)

  if (candidates.length === 0) {
    notes.push("No plan fits your availability and rest days. Try ticking more time slots or allowing fewer rest days.")
    return { plans: [], effectiveMinRest, notes }
  }

  const picked = pickCandidates(candidates, input.sameTime, n, notes, STRATEGY_TEXT, {
    quietest: (c) => c.total,
    consistent: (c) => -10 * c.distinctBlocks + c.total,
    spread: (c) => c.total / n + 0.25 * c.evenness,
  })
  const plans = picked.map(({ strategy, c }) => buildPlan(strategy, c, workouts, prepared, STRATEGY_TEXT))
  return { plans, effectiveMinRest, notes }
}

export const SEVEN_DAY_NOTE =
  "7 workouts a week leaves no rest days. That’s allowed, but muscles recover on rest days: consider alternating muscle groups or keeping some sessions light."

// picks one candidate per strategy, each different from the earlier picks in at least 2 slots
// (just 1 if there arent enough options)
export function pickCandidates(
  candidates: readonly candidate[],
  sameTime: boolean,
  n: number,
  notes: string[],
  text: Record<strategyType, { title: string }>,
  objective: Record<strategyType, (c: candidate) => number>,
): { strategy: strategyType; c: candidate }[] {
  const pool = sameTime ? candidates.filter((c) => c.sameTime) : candidates
  if (sameTime && pool.length === 0) {
    notes.push('No single time slot works on enough days for "same time each day", so that option was ignored.')
  }
  const base = pool.length ? pool : candidates
  const order: strategyType[] = ["quietest", "consistent", "spread"]
  const picked: { strategy: strategyType; c: candidate }[] = []
  const need = Math.min(2, n)

  for (const strategy of order) {
    const ranked = [...base].sort((a, b) => objective[strategy](b) - objective[strategy](a))
    let choice: candidate | undefined
    for (const required of [need, 1]) {
      choice = ranked.find((c) => picked.every((p) => slotDifference(c.keys, p.c.keys) >= required))
      if (choice) {
        if (required < need) notes.push(`${text[strategy].title} only differs from an earlier plan in one slot: there aren't enough options.`)
        break
      }
    }
    if (choice) picked.push({ strategy, c: choice })
  }
  return picked
}

// turns a candidate into a Plan, one entry per workout
// for drifting patterns thats its first occurrence, the full schedule is in calendar
export function buildPlan(
  strategy: strategyType,
  c: candidate,
  workouts: readonly workoutInput[],
  prepared: readonly preparedType[],
  text: Record<strategyType, { title: string; summary: string }>,
): Plan {
  const first = new Map<number, number>()
  for (let i = 0; i < c.workoutOf.length; i++) {
    const w = c.workoutOf[i]
    if (!first.has(w)) first.set(w, i)
  }
  const planned: plannedWorkout[] = [...first].map(([w, i]) => {
    const slot = c.slots[i]
    return {
      workoutIndex: w,
      name: workouts[w].name,
      slot,
      kinds: prepared[w].kinds,
      substitutions: prepared[w].substitutions,
      units: suggestUnits(prepared[w].kinds, slot),
      durationSeconds: prepared[w].durationSeconds,
      order: machineOrder(slot),
      explanation: explain(prepared[w].kinds, slot),
    }
  })
  if (!c.calendar) planned.sort((a, b) => a.slot.day - b.slot.day)
  let summary = text[strategy].summary
  if (strategy === "consistent" && !c.sameTime) summary = "No single slot fits every workout day; this keeps times as similar as possible."
  return {
    strategy,
    title: text[strategy].title,
    summary,
    workouts: planned,
    // missed workout days (no available slot) count as 0
    score: displayScore(c.total / Math.max(1, c.slots.length + c.missed)),
    minRest: c.minRest,
    ...(c.calendar ? { calendar: c.calendar, missed: c.missed } : {}),
  }
}

// the note when a kind got swapped, for example "Pec deck is out of service ..., so Cable crossover is planned instead."
export function substitutionText(s: substitution, kinds: readonly plannerKind[]): string {
  const orig = kinds.find((k) => k.id === s.originalId)?.name ?? s.originalId
  const sub = kinds.find((k) => k.id === s.substituteId)?.name
  if (sub) return `${orig} is out of service (no unit in service right now), so ${sub} is planned instead.`
  return `${orig} is out of service and no other machine in its group is available.`
}

// adds up a list
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

// population variance, 0 for an empty list
function variance(xs: number[]): number {
  if (xs.length === 0) return 0
  const m = sum(xs) / xs.length
  return sum(xs.map((x) => (x - m) ** 2)) / xs.length
}
