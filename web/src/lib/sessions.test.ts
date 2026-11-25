// SESSION TESTS
// Purpose: sessions and intervals from the event stream

import { describe, expect, it } from "vitest"
import { averageWorkoutSeconds, deriveSessions, median } from "./sessions"
import { eventsToIntervals } from "./intervals"
import { d, ev, session } from "./testUtils"

describe("deriveSessions", () => {
  it("builds a session from AVAILABLE→ACTIVE…RESTING→AVAILABLE with active/resting split", () => {
    const t = d(2026, 11, 16, 17, 0)
    const events = [
      ev("LE01", "AVAILABLE", d(2026, 11, 16, 16, 0)),
      ev("LE01", "ACTIVE", t),
      ev("LE01", "RESTING", d(2026, 11, 16, 17, 1)),
      ev("LE01", "ACTIVE", d(2026, 11, 16, 17, 3)),
      ev("LE01", "RESTING", d(2026, 11, 16, 17, 4)),
      ev("LE01", "AVAILABLE", d(2026, 11, 16, 17, 7)),
    ]
    const [s, ...rest] = deriveSessions(events)
    expect(rest).toHaveLength(0)
    expect(s.start).toBe(t.toISOString())
    expect(s.end).toBe(d(2026, 11, 16, 17, 7).toISOString())
    expect(s.lastActiveEnd).toBe(d(2026, 11, 16, 17, 4).toISOString())
    expect(s.activeSeconds).toBe(120)
    expect(s.restingSeconds).toBe(300)
    expect(s.workoutSeconds).toBe(240)
    expect(s.occupiedSeconds).toBe(420)
  })

  it("ignores open sessions and sessions whose start is unknown", () => {
    const events = [
      ev("LE01", "RESTING", d(2026, 11, 16, 9, 0)), // start unknown
      ev("LE01", "AVAILABLE", d(2026, 11, 16, 9, 3)),
      ev("LE01", "ACTIVE", d(2026, 11, 16, 10, 0)), // still open
    ]
    expect(deriveSessions(events)).toEqual([])
  })

  it("handles unsorted, multi-machine input and duplicate states", () => {
    const events = [
      ...session("LP01", d(2026, 11, 16, 8, 0), 5, 3),
      ...session("LE01", d(2026, 11, 16, 7, 0), 10, 2),
      ev("LE01", "ACTIVE", d(2026, 11, 16, 7, 1)), // duplicate, ignored
    ].reverse()
    const sessions = deriveSessions(events)
    expect(sessions.map((s) => s.machineId)).toEqual(["LE01", "LP01"])
    expect(sessions[0].activeSeconds).toBe(600)
    expect(averageWorkoutSeconds(sessions)).toBe((10 * 60 + 5 * 60) / 2)
  })

  it("averages to 0 with no sessions", () => {
    expect(averageWorkoutSeconds([])).toBe(0)
  })

  it("computes medians", () => {
    expect(median([])).toBe(0)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe("eventsToIntervals", () => {
  it("clips to the window and carries state in from before it", () => {
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 16, 8, 0)), ev("LE01", "AVAILABLE", d(2026, 11, 16, 10, 0))]
    const iv = eventsToIntervals(events, d(2026, 11, 16, 11).getTime(), d(2026, 11, 16, 9).getTime())
    expect(iv).toEqual([
      { machineId: "LE01", state: "ACTIVE", start: d(2026, 11, 16, 9).getTime(), end: d(2026, 11, 16, 10).getTime() },
      { machineId: "LE01", state: "AVAILABLE", start: d(2026, 11, 16, 10).getTime(), end: d(2026, 11, 16, 11).getTime() },
    ])
  })
})
