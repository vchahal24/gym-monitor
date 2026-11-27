// REST PATTERN TESTS
// Purpose: weekly and drifting rest pattern plans

import { describe, expect, it } from "vitest"
import { d } from "../testUtils"
import type { MachineKind } from "../../types"
import { cycleLength, cycleOffsets, generatePatternPlans, normalizePattern, planWeek, type plannerData, type plannerKind, type weeklyInput } from "."

function grid<T>(f: (day: number, block: number) => T): T[][] {
  return Array.from({ length: 7 }, (_, day) => Array.from({ length: 7 }, (_, b) => f(day, b)))
}
// placeholder kind ids keep the cases readable
function machine(id: string, pFree: number[][]): plannerKind {
  return {
    id: id as MachineKind,
    name: id,
    group: "legs",
    units: [],
    pFree,
    typicalFree: grid(() => 1),
    avgWorkoutSeconds: 600,
    operational: true,
  }
}

// each machine is clearly quietest on one weekday at 7–9 am
function quietOn(day: number) {
  return grid((dd, b) => (dd === day && b === 0 ? 0.95 : 0.4))
}
const data: plannerData = {
  gymOccupancy: grid(() => 0.3),
  kinds: [
    machine("A", quietOn(0)),
    machine("B", quietOn(1)),
    machine("C", quietOn(4)),
    machine("D", quietOn(6)),
    machine(
      "E",
      grid(() => 0.6),
    ),
  ],
}
const workouts = ["A", "B", "C", "D"].map((id) => ({ name: id, kinds: [id as MachineKind] }))
const all = grid(() => true)
function input(pattern: weeklyInput["pattern"], extra: Partial<weeklyInput> = {}): weeklyInput {
  return {
    workouts,
    availability: all,
    minRestDays: 0,
    sameTime: false,
    pattern,
    ...extra,
  }
}
const MON = d(2026, 11, 23, 10)

describe("rest pattern basics", () => {
  it("normalises order and rest days", () => {
    expect(normalizePattern({ order: [2, 2, 9, 0], restAfter: [1, -3, 2.7] }, 3)).toEqual({ order: [2, 0, 1], restAfter: [1, 0, 2] })
    expect(normalizePattern(null, 2)).toEqual({ order: [0, 1], restAfter: [1, 1] })
  })

  it("A → 0 → B → 2 → C → 1 → D → 0 is a 7-day cycle", () => {
    const p = { order: [0, 1, 2, 3], restAfter: [0, 2, 1, 0] }
    expect(cycleLength(p)).toBe(7)
    expect(cycleOffsets(p)).toEqual([0, 1, 4, 6])
  })
})

describe("7-day pattern: rotation over the starting weekday", () => {
  const r = generatePatternPlans(input({ order: [0, 1, 2, 3], restAfter: [0, 2, 1, 0] }), data, MON)

  it("finds the start day that lines every workout up with its quiet day", () => {
    // Monday start puts A Mon, B Tue, C Fri, D Sun: each on its quietest day
    expect(r.cycleDays).toBe(7)
    const best = r.plans[0]
    expect(best.cycle).toMatchObject({ days: 7, drift: false, startDay: 0 })
    expect(best.workouts.map((w) => [w.name, w.slot.day, w.slot.block])).toEqual([
      ["A", 0, 0],
      ["B", 1, 0],
      ["C", 4, 0],
      ["D", 6, 0],
    ])
    expect(best.minRest).toBe(0)
  })

  it("returns 3 alternatives that differ in at least 2 slots", () => {
    expect(r.plans).toHaveLength(3)
    const keys = r.plans.map((p) => new Set(p.workouts.map((w) => `${w.slot.day}:${w.slot.block}`)))
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect([...keys[i]].filter((k) => !keys[j].has(k)).length).toBeGreaterThanOrEqual(2)
  })

  it("keeps the pattern spacing in every alternative", () => {
    for (const p of r.plans) {
      const byName = new Map(p.workouts.map((w) => [w.name, w.slot.day]))
      function gap(a: string, b: string) {
        return (byName.get(b)! - byName.get(a)! + 7) % 7
      }
      expect([gap("A", "B"), gap("B", "C"), gap("C", "D"), gap("D", "A")]).toEqual([1, 3, 2, 1])
    }
  })

  it('"same time every day" works with patterns', () => {
    const same = generatePatternPlans(input({ order: [0, 1, 2, 3], restAfter: [0, 2, 1, 0] }, { sameTime: true }), data, MON)
    for (const p of same.plans) expect(new Set(p.workouts.map((w) => w.slot.block)).size).toBe(1)
  })
})

describe("non-7-day pattern drifts across weeks", () => {
  // A → 1 → B → 2: a 5-day cycle
  const r = planWeek(input({ order: [0, 1], restAfter: [1, 2] }, { workouts: workouts.slice(0, 2) }), data, MON)

  it("lays the cycle out on a 4-week calendar", () => {
    expect(r.cycleDays).toBe(5)
    const p = r.plans[0]
    expect(p.cycle).toMatchObject({ days: 5, drift: true })
    expect(p.calendar).toHaveLength(28)
    const workoutDays = p.calendar!.map((c, t) => [t, c.workoutIndex] as const).filter(([, w]) => w !== null)
    // every 5 days A, then B two days later
    for (let i = 1; i < workoutDays.length; i++) {
      const [t, w] = workoutDays[i]
      const [pt, pw] = workoutDays[i - 1]
      expect(w).not.toBe(pw)
      expect(t - pt).toBe(pw === 0 ? 2 : 3)
    }
    expect(workoutDays.length).toBeGreaterThanOrEqual(10)
    // it isnt the same weekday every time: thats the drift
    expect(new Set(workoutDays.filter(([, w]) => w === 0).map(([t]) => (t + 0) % 7)).size).toBeGreaterThan(1)
  })

  it("scores the average and offers alternatives with different start days", () => {
    expect(r.plans.length).toBeGreaterThanOrEqual(2)
    expect(r.plans[0].score).toBeGreaterThanOrEqual(r.plans[1].score - 10)
    expect(r.notes.some((n) => /drifts/.test(n))).toBe(true)
  })

  it("counts days with no available slot as missed", () => {
    const weekdaysOnly = grid((day) => day < 5)
    const m = planWeek(input({ order: [0, 1], restAfter: [1, 2] }, { workouts: workouts.slice(0, 2), availability: weekdaysOnly }), data, MON)
    expect(m.plans[0].missed).toBeGreaterThan(0)
    const missedDays = m.plans[0].calendar!.filter((c) => c.workoutIndex !== null && c.slot === null)
    expect(missedDays.every((c) => new Date(c.date).getDay() % 6 === 0)).toBe(true) // Sat or Sun
  })
})

describe("0-rest-day sequences", () => {
  it("back-to-back workouts land on consecutive days", () => {
    // A → 0 → B → 0 → C → 4: three days on, four off (7 days)
    const r = generatePatternPlans(input({ order: [0, 1, 2], restAfter: [0, 0, 4] }, { workouts: workouts.slice(0, 3) }), data, MON)
    for (const p of r.plans) {
      const days = p.workouts.map((w) => w.slot.day)
      const byName = new Map(p.workouts.map((w) => [w.name, w.slot.day]))
      expect((byName.get("B")! - byName.get("A")! + 7) % 7).toBe(1)
      expect((byName.get("C")! - byName.get("B")! + 7) % 7).toBe(1)
      expect(new Set(days).size).toBe(3)
    }
  })

  it("7 workouts with no rest days is allowed, with a gentle note", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: `W${i}`, kinds: ["E" as MachineKind] }))
    const r = generatePatternPlans(input({ order: [0, 1, 2, 3, 4, 5, 6], restAfter: [0, 0, 0, 0, 0, 0, 0] }, { workouts: seven }), data, MON)
    expect(r.cycleDays).toBe(7)
    expect(new Set(r.plans[0].workouts.map((w) => w.slot.day)).size).toBe(7)
    expect(r.notes.some((n) => /no rest days/.test(n))).toBe(true)
  })

  it("an all-zero cycle shorter than a week repeats every few days", () => {
    const r = planWeek(input({ order: [0, 1, 2], restAfter: [0, 0, 0] }, { workouts: workouts.slice(0, 3) }), data, MON)
    expect(r.cycleDays).toBe(3)
    const cal = r.plans[0].calendar!
    const start = cal.findIndex((c) => c.workoutIndex !== null)
    expect(cal.slice(start).every((c) => c.workoutIndex !== null)).toBe(true)
  })
})

describe("simple mode with 7 workouts a week", () => {
  it("uses every day, lowers the rest constraint to 0 and adds the gentle note", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: `W${i}`, kinds: ["E" as MachineKind] }))
    const r = planWeek(input(null, { workouts: seven, minRestDays: 1 }), data, MON)
    expect(r.effectiveMinRest).toBe(0)
    expect(r.plans.length).toBeGreaterThan(0)
    expect(new Set(r.plans[0].workouts.map((w) => w.slot.day)).size).toBe(7)
    expect(r.notes[0]).toMatch(/no rest days/)
  })
})
