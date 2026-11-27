// PLANNER TESTS
// Purpose: scoring, the today planner, weekly plans and the .ics export

import { describe, expect, it } from "vitest"
import { d } from "../testUtils"
import {
  bestAlternativeDays,
  blocksNeeded,
  estimateDurationSeconds,
  feasibleRest,
  generatePlans,
  machineOrder,
  nextWeekday,
  planToICS,
  rankBlocksToday,
  resolveKinds,
  restGaps,
  slotDifference,
  slotScore,
  todayOutlook,
  type plannerData,
  type plannerKind,
  type weeklyInput,
} from "."
import type { MachineKind } from "../../types"

function grid<T>(f: (day: number, block: number) => T): T[][] {
  return Array.from({ length: 7 }, (_, day) => Array.from({ length: 7 }, (_, b) => f(day, b)))
}

function machine(id: MachineKind, group: plannerKind["group"], pFree: number[][], extra: Partial<plannerKind> = {}): plannerKind {
  return { id, name: id, group, units: [], pFree, typicalFree: grid(() => 1), avgWorkoutSeconds: 600, operational: true, ...extra }
}

// busy weekday evenings, quiet mornings; Monday 7–9 am is the quietest of all
const typical = grid((day, b) => (day === 0 && b === 0 ? 0.95 : b >= 5 && day < 5 ? 0.2 : 0.7 - b * 0.02))
const data: plannerData = {
  gymOccupancy: grid((_, b) => (b >= 5 ? 0.8 : 0.3)),
  kinds: [
    machine("leg-extension", "legs", typical),
    machine("leg-press", "legs", typical),
    machine(
      "leg-curl",
      "legs",
      grid(() => 0.5),
    ),
    machine(
      "hack-squat",
      "legs",
      grid(() => 0.9),
    ),
    machine("treadmill", "cardio", typical),
    // every unit out of service
    machine(
      "calf-raise",
      "legs",
      grid(() => 1),
      { operational: false },
    ),
    machine("chest-press", "chest-shoulders-triceps", typical),
    machine("lat-pulldown", "back-biceps", typical),
  ],
}
function all(v = true) {
  return grid(() => v)
}

describe("scoring", () => {
  it("rewards the mean, penalises the weakest link and crowding", () => {
    const [a, b] = [
      machine(
        "leg-press",
        "legs",
        grid(() => 0.9),
      ),
      machine(
        "leg-curl",
        "legs",
        grid(() => 0.5),
      ),
    ]
    const s = slotScore([a, b], data, 0, 0)!
    expect(s.mean).toBeCloseTo(0.7)
    expect(s.min).toBeCloseTo(0.5)
    expect(s.score).toBeCloseTo(0.7 - 0.25 * 0.5 - 0.1 * 0.3)
    const balanced = slotScore(
      [
        machine(
          "leg-press",
          "legs",
          grid(() => 0.7),
        ),
        machine(
          "leg-curl",
          "legs",
          grid(() => 0.7),
        ),
      ],
      data,
      0,
      0,
    )!
    expect(balanced.score).toBeGreaterThan(s.score)
  })

  it("averages over the blocks a long workout spans, and rejects running past 9 pm", () => {
    const m = machine(
      "leg-press",
      "legs",
      grid((_, b) => (b === 0 ? 1 : 0.5)),
    )
    expect(slotScore([m], data, 0, 0, 2)!.mean).toBeCloseTo(0.75)
    expect(slotScore([m], data, 0, 6, 2)).toBeNull()
  })

  it("estimates duration from average workouts plus changeovers", () => {
    const ms = data.kinds.slice(0, 3)
    expect(estimateDurationSeconds(ms)).toBe(3 * 600 + 2 * 120)
    expect(blocksNeeded(7200)).toBe(1)
    expect(blocksNeeded(7201)).toBe(2)
  })

  it("orders kinds most contested first; with equal odds, the kind with more units free goes later", () => {
    const slot = {
      perMachine: [
        { id: "treadmill" as const, pFree: 0.9, typicalFree: 3 },
        { id: "pec-deck" as const, pFree: 0.3, typicalFree: 0.3 },
        { id: "chest-press" as const, pFree: 0.6, typicalFree: 1.2 },
        { id: "leg-press" as const, pFree: 0.6, typicalFree: 0.6 },
      ],
    }
    expect(machineOrder(slot)).toEqual(["pec-deck", "leg-press", "chest-press", "treadmill"])
  })

  it("swaps a fully unavailable kind for the best same-group kind not already picked", () => {
    // with no similarity map: the kind most often free
    const r = resolveKinds(["calf-raise", "leg-extension"], data.kinds, {})
    expect(r.substitutions).toEqual([{ originalId: "calf-raise", substituteId: "hack-squat" }])
    expect(r.kinds.map((m) => m.id)).toEqual(["hack-squat", "leg-extension"])
    // hack squat already picked → the next best leg kind
    expect(resolveKinds(["hack-squat", "calf-raise"], data.kinds, {}).substitutions[0].substituteId).toBe("leg-extension")
  })

  it("prefers a similar movement over the most-often-free kind", () => {
    // calf raise → leg press (similar), even though hack squat is free more often
    expect(resolveKinds(["calf-raise"], data.kinds).substitutions[0].substituteId).toBe("leg-press")
    expect(resolveKinds(["calf-raise"], data.kinds, { "calf-raise": ["leg-curl"] }).substitutions[0].substituteId).toBe("leg-curl")
  })
})

describe("today", () => {
  const legs = data.kinds.filter((m) => ["leg-extension", "leg-press"].includes(m.id))
  it("ranks the blocks that have not ended, including the one in progress", () => {
    const r = rankBlocksToday(legs, data, d(2026, 11, 16, 8, 30)) // Monday 8:30, inside 7–9 am
    expect(r).toHaveLength(7)
    const now = r.find((s) => s.block === 0)!
    expect(now.current).toBe(true)
    expect(now.remainingMs).toBe(30 * 60_000)
    expect(r.filter((s) => s.current)).toHaveLength(1)
    expect(r.at(-1)!.block).toBeGreaterThanOrEqual(5)
  })

  it('drops blocks that have ended (fake clock 8:15 pm: only 7–9 pm is left, as "now")', () => {
    const r = rankBlocksToday(legs, data, d(2026, 11, 16, 20, 15))
    expect(r.map((s) => s.block)).toEqual([6])
    expect(r[0]).toMatchObject({ current: true, remainingMs: 45 * 60_000, end: d(2026, 11, 16, 21).getTime() })
  })

  it("at 9:30 pm says nothing is left and offers tomorrow and the rest of the week", () => {
    const o = todayOutlook(legs, data, d(2026, 11, 16, 21, 30)) // Monday 9:30 pm
    expect(o.today).toEqual([])
    expect(o.nothingLeft).toBe(true)
    expect(o.tomorrow).toHaveLength(3)
    expect(o.tomorrow.every((s) => s.day === 1 && !s.current)).toBe(true)
    // rest of the week: Wednesday to Sunday
    expect(o.laterDays).toHaveLength(3)
    expect(o.laterDays.every((s) => s.day >= 2 && s.day <= 6)).toBe(true)
  })

  it("in the afternoon, has blocks left and no tomorrow list", () => {
    const o = todayOutlook(legs, data, d(2026, 11, 16, 14))
    expect(o.nothingLeft).toBe(false)
    expect(o.today.map((s) => s.block).sort()).toEqual([3, 4, 5, 6])
    expect(o.tomorrow).toEqual([])
  })

  it("suggests other days, best first", () => {
    const r = bestAlternativeDays(legs, data, d(2026, 11, 17, 12)) // Tuesday → next Mondays 7–9 am is best
    expect(r[0]).toMatchObject({ day: 0, block: 0 })
    expect(r).toHaveLength(3)
  })
})

describe("weekly plan helpers", () => {
  it("measures rest gaps around the week", () => {
    expect(restGaps([0, 2, 4])).toEqual([1, 1, 2])
    expect(restGaps([3])).toEqual([])
  })

  it("lowers the rest requirement when it cannot fit", () => {
    expect(feasibleRest(3, 1)).toBe(1)
    expect(feasibleRest(4, 1)).toBe(0)
    expect(feasibleRest(6, 2)).toBe(0)
    expect(feasibleRest(2, 2)).toBe(2)
  })

  it("counts differing slots", () => {
    expect(
      slotDifference(
        [
          { day: 0, block: 0 },
          { day: 2, block: 1 },
        ],
        [
          { day: 0, block: 0 },
          { day: 2, block: 3 },
        ],
      ),
    ).toBe(1)
  })
})

describe("generatePlans", () => {
  const input: weeklyInput = {
    workouts: [
      { name: "Legs", kinds: ["leg-extension", "leg-press", "treadmill"] },
      { name: "Push", kinds: ["chest-press"] },
      { name: "Pull", kinds: ["lat-pulldown"] },
    ],
    availability: all(),
    minRestDays: 1,
    sameTime: false,
  }

  it("returns 3 plans from different strategies, each differing in ≥ 2 slots", () => {
    const r = generatePlans(input, data)
    expect(r.plans.map((p) => p.strategy)).toEqual(["quietest", "consistent", "spread"])
    for (let i = 0; i < r.plans.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(
          slotDifference(
            r.plans[i].workouts.map((w) => w.slot),
            r.plans[j].workouts.map((w) => w.slot),
          ),
        ).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it("respects rest days, availability and distinct days", () => {
    const evenings = grid((day, b) => day < 5 && b >= 5)
    const r = generatePlans({ ...input, availability: evenings }, data)
    for (const p of r.plans) {
      const days = p.workouts.map((w) => w.slot.day)
      expect(new Set(days).size).toBe(days.length)
      expect(Math.min(...restGaps(days))).toBeGreaterThanOrEqual(1)
      p.workouts.forEach((w) => expect(evenings[w.slot.day][w.slot.block]).toBe(true))
    }
  })

  it("puts the quietest plan on the quietest slots and explains it", () => {
    const r = generatePlans(input, data)
    const legs = r.plans[0].workouts.find((w) => w.name === "Legs")!
    expect(legs.slot).toMatchObject({ day: 0, block: 0 })
    expect(legs.explanation).toBe("Your machines are free 95% of the time on Mon 7–9 am")
    expect(r.plans[0].workouts.find((w) => w.name === "Push")!.explanation).toMatch(/^Your chest, shoulders & triceps machines are free/)
  })

  it("keeps the consistent plan in one time slot", () => {
    const r = generatePlans(input, data)
    const blocks = new Set(r.plans[1].workouts.map((w) => w.slot.block))
    expect(blocks.size).toBe(1)
  })

  it('with "same time each day", every plan uses one slot', () => {
    const r = generatePlans({ ...input, sameTime: true }, data)
    expect(r.plans.length).toBeGreaterThanOrEqual(2)
    r.plans.forEach((p) => expect(new Set(p.workouts.map((w) => w.slot.block)).size).toBe(1))
  })

  it("relaxes infeasible rest days and says so", () => {
    const six = { ...input, workouts: Array.from({ length: 6 }, (_, i) => ({ name: `W${i}`, kinds: ["chest-press" as const] })), minRestDays: 1 }
    const r = generatePlans(six, data)
    expect(r.effectiveMinRest).toBe(0)
    expect(r.notes[0]).toMatch(/don't fit/)
    expect(r.plans[0].workouts).toHaveLength(6)
  })

  it("swaps in another kind when a planned kind is fully out of service, and says so", () => {
    const r = generatePlans({ ...input, workouts: [{ name: "Legs", kinds: ["calf-raise"] }] }, data)
    expect(r.notes.some((n) => /calf-raise is out of service .*, so leg-press is planned instead/.test(n))).toBe(true)
    expect(r.plans[0].workouts[0].kinds[0].id).toBe("leg-press")
  })

  it("spans two blocks for long workouts", () => {
    const long = { ...data, kinds: data.kinds.map((m) => (m.id === "treadmill" ? { ...m, avgWorkoutSeconds: 2.5 * 3600 } : m)) }
    const r = generatePlans({ ...input, workouts: [{ name: "Run", kinds: ["treadmill"] }] }, long)
    expect(r.plans[0].workouts[0].slot.blocks).toBe(2)
    expect(r.plans[0].workouts[0].slot.block).toBeLessThanOrEqual(5)
  })

  it("reports when nothing fits", () => {
    const r = generatePlans({ ...input, availability: all(false) }, data)
    expect(r.plans).toEqual([])
    expect(r.notes.at(-1)).toMatch(/No plan fits/)
  })
})

describe("planToICS", () => {
  it("writes a weekly recurring event per workout", () => {
    const r = generatePlans({ workouts: [{ name: "Legs", kinds: ["leg-extension", "leg-press"] }], availability: all(), minRestDays: 1, sameTime: false }, data)
    const ics = planToICS(r.plans[0], data.kinds, d(2026, 11, 18, 10))
    expect(ics).toContain("BEGIN:VCALENDAR\r\n")
    expect(ics).toContain("RRULE:FREQ=WEEKLY")
    expect(ics).toContain("DTSTART:20261123T070000") // next Monday 7 am
    expect(ics).toContain("SUMMARY:Gym: Legs")
    expect(nextWeekday(d(2026, 11, 23, 15), 0).getDate()).toBe(23)
  })
})
