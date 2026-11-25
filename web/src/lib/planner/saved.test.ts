// SAVED PLANNER DATA TESTS
// Purpose: stored picks and plans are checked and old machine IDs dropped

import { describe, expect, it } from "vitest"
import { cleanForm, cleanPicked, cleanSavedPlans } from "./saved"

const known = new Set(["leg-extension", "leg-press", "chest-press"])
const defaults = {
  count: 3,
  workouts: [
    { name: "A", kinds: ["leg-extension"] },
    { name: "B", kinds: ["chest-press"] },
  ],
  availability: [
    [true, true],
    [true, true],
  ],
  minRest: 1,
  sameTime: false,
}

describe("stored planner data (by kind) and old machine IDs", () => {
  it("drops machine IDs and unknown values from today picks", () => {
    // round 2 (M02), round 3 (L02) and even current unit IDs (LP01) are not kinds
    expect(cleanPicked(["M02", "L02", "LP01", 7], known)).toEqual([])
    expect(cleanPicked(["M02", "leg-press", "chest-press", "leg-press"], known)).toEqual(["leg-press", "chest-press"])
    expect(cleanPicked("garbage", known)).toEqual([])
  })

  it("discards saved plans stored by unit or malformed", () => {
    const good = { id: "1", savedAt: "x", plan: { workouts: [{ slot: {}, kinds: [{ id: "leg-press" }] }] } }
    const byUnit = { id: "2", savedAt: "x", plan: { workouts: [{ slot: {}, machines: [{ id: "LP01" }] }] } }
    const unknownKind = { id: "3", savedAt: "x", plan: { workouts: [{ slot: {}, kinds: [{ id: "M01" }] }] } }
    const { plans, dropped } = cleanSavedPlans([good, byUnit, unknownKind, null, { id: 3 }], known)
    expect(plans.map((p) => p.id)).toEqual(["1"])
    expect(dropped).toBe(4)
    expect(cleanSavedPlans({ not: "an array" }, known).plans).toEqual([])
  })

  it("merges a stored weekly form safely", () => {
    const stored = {
      count: 2,
      workouts: [
        { name: "Old", machineIds: ["L01", "L02"] },
        { name: "Mine", kinds: ["leg-press", "M10"] },
        { name: "Gone", kinds: ["M10"] },
      ],
      availability: "bad",
      minRest: "2",
    }
    const f = cleanForm(stored, { ...defaults, workouts: [...defaults.workouts, { name: "C", kinds: ["leg-press"] }] }, known)
    expect(f.count).toBe(2)
    // saved by machine ID (old version) or all unknown → the template; mixed keeps the known kinds
    expect(f.workouts).toEqual([
      { name: "A", kinds: ["leg-extension"] },
      { name: "Mine", kinds: ["leg-press"] },
      { name: "Gone", kinds: ["leg-press"] },
    ])
    expect(f.availability).toBe(defaults.availability)
    expect(f.minRest).toBe(1)
    expect(cleanForm(null, defaults, known)).toBe(defaults)
  })
})
