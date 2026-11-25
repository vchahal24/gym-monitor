// SUMMARY TESTS
// Purpose: live utilisation, the summary and the busiest block today

import { describe, expect, it } from "vitest"
import type { Machine, MachineState } from "../types"
import { busiestBlockToday, computeSummary, computeUtilisation, sessionsStartedToday } from "./summary"
import { deriveSessions } from "./sessions"
import { d, ev, session } from "./testUtils"

function m(id: string, state: MachineState, online = true, inMaintenance = false): Machine {
  return {
    id,
    name: id,
    zoneId: "legs",
    override: null,
    group: "legs",
    kind: "leg-press",
    state,
    since: "",
    sessionStartedAt: state === "AVAILABLE" ? null : "",
    online,
    lastHeartbeat: null,
    maintenance: inMaintenance ? { since: "", reason: "x", expectedBack: null } : null,
  }
}

describe("computeUtilisation", () => {
  it("is (active + resting) / online machines", () => {
    expect(computeUtilisation([m("a", "ACTIVE"), m("b", "RESTING"), m("c", "AVAILABLE"), m("d", "AVAILABLE")])).toBe(0.5)
  })

  it("excludes offline machines from both sides", () => {
    expect(computeUtilisation([m("a", "ACTIVE"), m("b", "AVAILABLE"), m("c", "ACTIVE", false)])).toBe(0.5)
  })

  it("excludes machines in maintenance", () => {
    expect(computeUtilisation([m("a", "ACTIVE"), m("b", "AVAILABLE"), m("c", "AVAILABLE", true, true)])).toBe(0.5)
  })

  it("is 0 with no online machines", () => {
    expect(computeUtilisation([])).toBe(0)
    expect(computeUtilisation([m("a", "ACTIVE", false)])).toBe(0)
  })
})

describe("computeSummary", () => {
  it("counts states and today’s sessions", () => {
    const now = d(2026, 11, 22, 12)
    const sessions = deriveSessions([
      ...session("LE01", d(2026, 11, 21, 18), 10, 2), // yesterday
      ...session("LE01", d(2026, 11, 22, 9), 8, 2),
      ...session("LP01", d(2026, 11, 22, 10), 18, 2),
    ])
    const s = computeSummary(
      [m("LE01", "ACTIVE"), m("LP01", "AVAILABLE"), m("LC01", "RESTING"), m("SLC01", "AVAILABLE", true, true)],
      sessionsStartedToday(sessions, now),
    )
    expect(s).toEqual({
      total: 4,
      operational: 3,
      reporting: 3,
      offline: 0,
      available: 1,
      active: 1,
      resting: 1,
      maintenance: 1,
      utilisation: 2 / 3,
      avgWorkoutSecondsToday: 13 * 60, // workouts of 8 and 18 min
      sessionsToday: 2,
    })
  })
})

describe("busiestBlockToday", () => {
  it("finds the block with the highest share of machine-time in use", () => {
    const now = d(2026, 11, 22, 12)
    const events = [...session("LE01", d(2026, 11, 22, 7, 0), 30, 0), ...session("LE01", d(2026, 11, 22, 9, 0), 60, 60)]
    // 9–11 am: one of two machines used for the full 2 h → 0.5
    expect(busiestBlockToday(events, ["LE01", "LP01"], now)).toEqual({ block: "9-11 am", value: 0.5 })
  })

  it("is null before anything has happened", () => {
    expect(busiestBlockToday([ev("LE01", "AVAILABLE", d(2026, 11, 22, 6))], ["LE01"], d(2026, 11, 22, 8))).toBeNull()
  })
})
