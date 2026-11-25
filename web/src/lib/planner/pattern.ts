// REST PATTERN PLANS
// Purpose: plans built from a custom rest pattern, weekly ones and ones that drift across weeks

import { addDays, mondayIndex, startOfDay } from "../time"
import type { plannerData, slotScoreType } from "./types"
import {
  PATTERN_TEXT,
  generatePlans,
  SEVEN_DAY_NOTE,
  buildPlan,
  pickCandidates,
  prepareWorkouts,
  type calendarDay,
  type candidate,
  type Plan,
  type restPattern,
  type weeklyInput,
  type weeklyResult,
} from "./weekly"

// a drifting cycle gets planned over this many days
export const DRIFT_HORIZON_DAYS = 28

// makes a pattern valid for n workouts
//   1. order becomes each of 0..n-1 once (unknown or repeated ones dropped, missing ones added on the end)
//   2. restAfter becomes whole numbers >= 0, one per position
export function normalizePattern(pattern: restPattern | null | undefined, n: number): restPattern {
  const seen = new Set<number>()
  const order: number[] = []
  for (const i of pattern?.order ?? []) {
    if (Number.isInteger(i) && i >= 0 && i < n && !seen.has(i)) {
      seen.add(i)
      order.push(i)
    }
  }
  for (let i = 0; i < n; i++) if (!seen.has(i)) order.push(i)
  const restAfter = order.map((_, i) => {
    const r = pattern?.restAfter?.[i]
    return Number.isFinite(r) ? Math.max(0, Math.min(14, Math.floor(r as number))) : 1
  })
  return { order, restAfter }
}

// days in one cycle, one per workout plus all the rest days
export function cycleLength(p: restPattern): number {
  return p.order.length + p.restAfter.reduce((a, b) => a + b, 0)
}

// which day of the cycle each position lands on (A at 0, then 1 + rest after A, ...)
export function cycleOffsets(p: restPattern): number[] {
  const out: number[] = []
  let t = 0
  for (let i = 0; i < p.order.length; i++) {
    out.push(t)
    t += 1 + p.restAfter[i]
  }
  return out
}

// plans from a custom rest pattern
//   1. a 7 day cycle repeats every week, so we try all 7 start weekdays, each workout gets its best block
//      on its day (or one shared block for "same time"), then 3 alternatives like the simple planner
//   2. any other length drifts across weeks, so each start day in the next week gets laid out over
//      the next 4 weeks and scored on the average over every workout day (a day with no slot counts as 0)
export function generatePatternPlans(input: weeklyInput, data: plannerData, now: Date = new Date()): weeklyResult {
  const all = input.workouts.slice(0, 7)
  const raw = normalizePattern(input.pattern, all.length)
  // a workout with no machines cant be planned, so its day (and the rest after it)
  // becomes rest for the workout before it in the cycle, wrapping round
  const keep = all.map((w) => w.kinds.length > 0)
  const order: number[] = []
  const restAfter: number[] = []
  let carry = 0
  for (let i = 0; i < raw.order.length; i++) {
    const w = raw.order[i]
    if (keep[w]) {
      order.push(w)
      restAfter.push(raw.restAfter[i])
    } else if (order.length) restAfter[restAfter.length - 1] += 1 + raw.restAfter[i]
    else carry += 1 + raw.restAfter[i]
  }
  if (carry && restAfter.length) restAfter[restAfter.length - 1] += carry

  const { workouts, prepared, notes } = prepareWorkouts(input, data)
  // prepareWorkouts drops empty workouts, so map our indices to its indices
  const idx = new Map<number, number>()
  for (let i = 0; i < all.length; i++) {
    if (all[i].kinds.length > 0) idx.set(i, idx.size)
  }
  const pattern: restPattern = { order: order.map((w) => idx.get(w)!), restAfter }
  const n = pattern.order.length
  if (n === 0) return { plans: [], effectiveMinRest: 0, notes: ["Add machines to at least one workout."] }
  if (keep.some((k) => !k)) notes.push("Workouts without machines are treated as rest days in your pattern.")

  const days = cycleLength(pattern)
  const offsets = cycleOffsets(pattern)
  const minRest = Math.min(...pattern.restAfter)
  if (n === 7 && days === 7) notes.unshift(SEVEN_DAY_NOTE)

  const candidates: candidate[] =
    days === 7 ? weeklyCandidates(pattern, offsets, prepared, minRest) : driftCandidates(pattern, offsets, days, prepared, minRest, now)
  if (days === 7) notes.unshift("Your cycle is exactly 7 days, so it repeats every week: all 7 starting weekdays were tried.")
  else notes.unshift(`Your cycle is ${days} days, so it drifts across the weeks. Each plan is laid out over the next 4 weeks and scored on the average.`)

  if (candidates.length === 0) {
    notes.push("No start day fits your availability. Try ticking more time slots or changing the rest days.")
    return { plans: [], effectiveMinRest: minRest, notes, cycleDays: days }
  }

  function avg(c: candidate) {
    return c.total / Math.max(1, c.slots.length + c.missed)
  }
  const picked = pickCandidates(candidates, input.sameTime, n, notes, PATTERN_TEXT, {
    quietest: (c) => avg(c),
    consistent: (c) => -10 * c.distinctBlocks + avg(c),
    // out of whats left, starting sooner is better
    spread: (c) => avg(c) - 0.01 * (c.startDay ?? 0),
  })
  const plans: Plan[] = picked.map(({ strategy, c }) => ({
    ...buildPlan(strategy, c, workouts, prepared, PATTERN_TEXT),
    cycle: { days, drift: days !== 7, order: pattern.order, restAfter: pattern.restAfter, ...(days === 7 ? { startDay: c.startDay } : {}) },
  }))
  return { plans, effectiveMinRest: minRest, notes, cycleDays: days }
}

function weeklyCandidates(pattern: restPattern, offsets: number[], prepared: ReturnType<typeof prepareWorkouts>["prepared"], minRest: number): candidate[] {
  const out: candidate[] = []
  for (let start = 0; start < 7; start++) {
    const dayOf = offsets.map((o) => (start + o) % 7)
    const free = pattern.order.map((w, i) => prepared[w].best[dayOf[i]])
    if (free.some((s) => !s)) continue
    const slots = free as slotScoreType[]
    const keys = slots.map((s) => `${s.day}:${s.block}`)
    out.push({
      slots,
      workoutOf: pattern.order,
      keys,
      total: slots.reduce((a, s) => a + s.score, 0),
      sameTime: slots.every((s) => s.block === slots[0].block),
      minRest,
      evenness: 1,
      distinctBlocks: new Set(slots.map((s) => s.block)).size,
      missed: 0,
      startDay: start,
    })
    for (let b = 0; b < 7; b++) {
      const same = pattern.order.map((w, i) => prepared[w].slots[dayOf[i]][b])
      if (same.some((s) => !s) || same.every((s, i) => s!.block === slots[i].block)) continue
      const ss = same as slotScoreType[]
      out.push({
        slots: ss,
        workoutOf: pattern.order,
        keys: ss.map((s) => `${s.day}:${s.block}`),
        total: ss.reduce((a, s) => a + s.score, 0),
        sameTime: true,
        minRest,
        evenness: 1,
        distinctBlocks: 1,
        missed: 0,
        startDay: start,
      })
    }
  }
  return out
}

function driftCandidates(
  pattern: restPattern,
  offsets: number[],
  days: number,
  prepared: ReturnType<typeof prepareWorkouts>["prepared"],
  minRest: number,
  now: Date,
): candidate[] {
  // day 0 is tomorrow because todays blocks might already be over
  const today = addDays(startOfDay(now), 1)
  const out: candidate[] = []
  // the cycle can start on any of the next few days (a full cycle or a week, whichever is shorter)
  for (let start = 0; start < Math.min(days, 7); start++) {
    const occ: { t: number; w: number; dow: number }[] = []
    for (let base = start; base < DRIFT_HORIZON_DAYS; base += days) {
      for (let i = 0; i < pattern.order.length; i++) {
        const w = pattern.order[i]
        const t = base + offsets[i]
        if (t < DRIFT_HORIZON_DAYS) occ.push({ t, w, dow: mondayIndex(addDays(today, t)) })
      }
    }
    occ.sort((a, b) => a.t - b.t)
    const variants: ((o: (typeof occ)[number]) => slotScoreType | null)[] = [
      (o) => prepared[o.w].best[o.dow],
      ...Array.from({ length: 7 }, (_, b) => (o: (typeof occ)[number]) => prepared[o.w].slots[o.dow][b]),
    ]
    for (let v = 0; v < variants.length; v++) {
      const pick = variants[v]
      const chosen = occ.map((o) => ({ ...o, slot: pick(o) }))
      const ok = chosen.filter((c) => c.slot) as ((typeof chosen)[number] & { slot: slotScoreType })[]
      if (ok.length === 0) continue
      const missed = chosen.length - ok.length
      // a same block variant that misses a day the free variant could do isnt worth showing
      if (v > 0 && missed > 0 && ok.every((c, i) => c.slot.block === ok[i].slot.block)) continue
      const calendar: calendarDay[] = Array.from({ length: DRIFT_HORIZON_DAYS }, (_, t) => ({
        date: addDays(today, t).getTime(),
        workoutIndex: null,
        slot: null,
      }))
      for (const c of chosen) calendar[c.t] = { date: calendar[c.t].date, workoutIndex: c.w, slot: c.slot }
      out.push({
        slots: ok.map((c) => c.slot),
        workoutOf: ok.map((c) => c.w),
        keys: ok.map((c) => `${c.t}:${c.slot.block}`),
        total: ok.reduce((a, c) => a + c.slot.score, 0),
        sameTime: ok.every((c) => c.slot.block === ok[0].slot.block),
        minRest,
        evenness: 1,
        distinctBlocks: new Set(ok.map((c) => c.slot.block)).size,
        missed,
        startDay: start,
        calendar,
      })
    }
  }
  return out
}

// where the weekly planner starts, the simple min rest search or the rest pattern if theres one
export function planWeek(input: weeklyInput, data: plannerData, now: Date = new Date()): weeklyResult {
  return input.pattern ? generatePatternPlans(input, data, now) : generatePlans(input, data)
}
