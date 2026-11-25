// REMAINING TIME TESTS
// Purpose: time left estimates, resting countdown, machine stats and applyEvent

import { describe, expect, it } from "vitest"
import { currentSessionSeconds, estimateRemainingSeconds, restingCountdownSeconds } from "./remaining"
import { computeMachineStats } from "./stats"
import { applyEvent } from "./machine"
import type { Machine } from "../types"
import { d, ev, session } from "./testUtils"

const NOW = d(2026, 11, 22, 18, 0)
function started(minAgo: number) {
  return new Date(NOW.getTime() - minAgo * 60_000).toISOString()
}

describe("estimateRemainingSeconds", () => {
  it("is average minus current duration", () => {
    expect(estimateRemainingSeconds({ state: "ACTIVE", sessionStartedAt: started(4) }, 600, NOW)).toBe(360)
    expect(estimateRemainingSeconds({ state: "RESTING", sessionStartedAt: started(9) }, 600, NOW)).toBe(60)
  })

  it("floors at 0 when the session runs over the average", () => {
    expect(estimateRemainingSeconds({ state: "ACTIVE", sessionStartedAt: started(30) }, 600, NOW)).toBe(0)
  })

  it("is null when available or without history", () => {
    expect(estimateRemainingSeconds({ state: "AVAILABLE", sessionStartedAt: null }, 600, NOW)).toBeNull()
    expect(estimateRemainingSeconds({ state: "ACTIVE", sessionStartedAt: started(1) }, 0, NOW)).toBeNull()
  })

  it("reports current session length", () => {
    expect(currentSessionSeconds({ sessionStartedAt: started(2) }, NOW)).toBe(120)
    expect(currentSessionSeconds({ sessionStartedAt: null }, NOW)).toBeNull()
  })
})

describe("restingCountdownSeconds", () => {
  it("counts down the 5-minute timeout from when movement stopped", () => {
    expect(restingCountdownSeconds({ state: "RESTING", since: started(0) }, NOW)).toBe(300)
    expect(restingCountdownSeconds({ state: "RESTING", since: new Date(NOW.getTime() - 78_000).toISOString() }, NOW)).toBe(222)
    expect(restingCountdownSeconds({ state: "RESTING", since: started(9) }, NOW)).toBe(0)
  })

  it("is null unless RESTING (so it resets when the machine goes ACTIVE)", () => {
    expect(restingCountdownSeconds({ state: "ACTIVE", since: started(1) }, NOW)).toBeNull()
    expect(restingCountdownSeconds({ state: "AVAILABLE", since: started(1) }, NOW)).toBeNull()
  })
})

describe("computeMachineStats", () => {
  it("derives the average, remaining time and per-day counts from events", () => {
    const events = [
      ...session("LP01", d(2026, 11, 20, 17), 8, 2), // 10 min
      ...session("LP01", d(2026, 11, 21, 17), 15, 5), // 20 min
      ev("LP01", "ACTIVE", new Date(started(5))), // in progress
    ]
    const machine: Machine = {
      id: "LP01",
      name: "Seated Leg Press",
      zoneId: "legs",
      override: null,
      group: "legs",
      kind: "leg-press",
      state: "ACTIVE",
      since: started(5),
      sessionStartedAt: started(5),
      online: true,
      lastHeartbeat: null,
      maintenance: null,
    }
    const stats = computeMachineStats(machine, events, NOW, { perDayDays: 3 })
    expect(stats.avgWorkoutSeconds).toBe(690) // workout = start → last ACTIVE end: (8 + 15) / 2 min
    expect(stats.medianWorkoutSeconds).toBe(690)
    expect(stats.estimatedRemainingSeconds).toBe(390)
    expect(stats.sessionsPerDay).toEqual([
      { date: "2026-11-20", count: 1 },
      { date: "2026-11-21", count: 1 },
      { date: "2026-11-22", count: 0 },
    ])
    expect(stats.recentSessions[0].start).toBe(d(2026, 11, 21, 17).toISOString())
  })
})

describe("applyEvent", () => {
  const base: Machine = {
    id: "LE01",
    name: "x",
    zoneId: "legs",
    override: null,
    group: "legs",
    kind: "leg-extension",
    state: "AVAILABLE",
    since: "a",
    sessionStartedAt: null,
    online: true,
    lastHeartbeat: null,
    maintenance: null,
  }

  it("opens, keeps and closes the session", () => {
    const t1 = d(2026, 11, 22, 9).toISOString()
    const a = applyEvent(base, { machineId: "LE01", state: "ACTIVE", timestamp: t1 })
    expect(a.sessionStartedAt).toBe(t1)
    const r = applyEvent(a, { machineId: "LE01", state: "RESTING", timestamp: "later" })
    expect(r.sessionStartedAt).toBe(t1)
    expect(r.since).toBe("later")
    const f = applyEvent(r, { machineId: "LE01", state: "AVAILABLE", timestamp: "end" })
    expect(f.sessionStartedAt).toBeNull()
  })

  it("ignores events for other machines and repeated states", () => {
    expect(applyEvent(base, { machineId: "LP01", state: "ACTIVE", timestamp: "t" })).toBe(base)
    expect(applyEvent(base, { machineId: "LE01", state: "AVAILABLE", timestamp: "t" })).toBe(base)
  })
})
