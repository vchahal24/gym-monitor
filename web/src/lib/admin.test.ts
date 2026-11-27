// ADMIN ANALYTICS TESTS
// Purpose: saturation, recommendations, rest insights and CSV

import { describe, expect, it } from "vitest"
import type { MachineStats } from "../types"
import { buildOccupancyGrid, popularity, recommendations, restInsights, saturationByBlock, saturationOver, toCSV, weeklyTrend, type machineInfo } from "./admin"
import { deriveSessions } from "./sessions"
import { d, ev } from "./testUtils"

// Monday 16 Nov 2026, 5–7 pm block
const from = d(2026, 11, 16).getTime()
const to = d(2026, 11, 17).getTime()

describe("saturation", () => {
  it("is the share of time all operational machines were busy at once", () => {
    const events = [
      ev("A", "ACTIVE", d(2026, 11, 16, 17)),
      ev("A", "RESTING", d(2026, 11, 16, 18, 55)),
      ev("A", "AVAILABLE", d(2026, 11, 16, 19)),
      ev("B", "ACTIVE", d(2026, 11, 16, 17, 30)),
      ev("B", "RESTING", d(2026, 11, 16, 18)),
      ev("B", "AVAILABLE", d(2026, 11, 16, 18, 30)),
    ]
    const grid = buildOccupancyGrid(events, ["A", "B"], [], from, to)
    expect(saturationByBlock(grid, ["A", "B"])[0][5]).toBeCloseTo(0.5) // both busy 5:30–6:30
    expect(saturationOver(grid, ["A", "B"], (day, b) => day === 0 && b === 5)).toBeCloseTo(0.5)
  })

  it("ignores machines in maintenance", () => {
    const events = [ev("A", "ACTIVE", d(2026, 11, 16, 17)), ev("A", "RESTING", d(2026, 11, 16, 18, 55)), ev("A", "AVAILABLE", d(2026, 11, 16, 19))]
    const down = [{ machineId: "B", start: from, end: to }]
    const grid = buildOccupancyGrid(events, ["A", "B"], down, from, to)
    expect(saturationByBlock(grid, ["A", "B"])[0][5]).toBeCloseTo(1)
  })

  it("computes a weekly utilisation trend", () => {
    const events = [ev("A", "ACTIVE", d(2026, 11, 16, 7)), ev("A", "RESTING", d(2026, 11, 16, 20, 55)), ev("A", "AVAILABLE", d(2026, 11, 16, 21))]
    const grid = buildOccupancyGrid(events, ["A"], [], from, d(2026, 11, 16, 21).getTime())
    const t = weeklyTrend(grid, d(2026, 11, 16, 21), 2)
    expect(t.at(-1)!.utilisation).toBeCloseTo(1)
    expect(t[0].utilisation).toBe(0)
  })
})

describe("recommendations", () => {
  const machines: machineInfo[] = [
    { id: "L1", name: "Lat Pulldown 1", group: "back-biceps", kind: "lat-pulldown" },
    { id: "L2", name: "Lat Pulldown 2", group: "back-biceps", kind: "lat-pulldown" },
    { id: "AD", name: "Hip Adductor", group: "legs", kind: "hip-adductor" },
  ]
  function stat(id: string, util: number, history: MachineStats["maintenanceHistory"] = []): MachineStats {
    return {
      machineId: id,
      utilisation: { today: 0, week: 0, fourWeeks: util },
      rank: 1,
      groupAvgUtilisation: 0,
      avgWorkoutSeconds: 600,
      medianWorkoutSeconds: 600,
      estimatedRemainingSeconds: null,
      sessionsPerDay: [{ date: "x", count: 3 }],
      recentSessions: [],
      maintenanceHistory: history,
      offlineHistory: [],
    }
  }

  it("recommends buying when same-kind machines are saturated, and flags low use", () => {
    const events = ["L1", "L2"].flatMap((id) => [
      ev(id, "ACTIVE", d(2026, 11, 16, 17)),
      ev(id, "RESTING", d(2026, 11, 16, 18, 55)),
      ev(id, "AVAILABLE", d(2026, 11, 16, 19)),
    ])
    const grid = buildOccupancyGrid(events, ["L1", "L2", "AD"], [], from, to)
    const rows = popularity(machines, [stat("L1", 0.6), stat("L2", 0.6), stat("AD", 0.06)], to)
    const recs = recommendations(machines, rows, grid, () => "Lat pulldown", new Map())
    expect(recs[0]).toMatchObject({ type: "buy", title: "Buy another lat pulldown" })
    // weekday 5–7 pm across the grids single Monday
    expect(recs[0].detail).toMatch(/^Both were busy at once during 100% of weekday 5–7 pm/)
    expect(recs.find((r) => r.type === "replace")?.detail).toMatch(/Hip Adductor is used 6% of the time/)
  })

  it("flags machines with a lot of downtime", () => {
    const hist = [{ since: d(2026, 11, 13).toISOString(), end: d(2026, 11, 15, 12).toISOString(), reason: "x", expectedBack: null }]
    const rows = popularity(machines, [stat("L1", 0.5, hist), stat("L2", 0.5), stat("AD", 0.5)], to)
    expect(rows.find((r) => r.id === "L1")!.downtimeHours).toBeCloseTo(60)
    const grid = buildOccupancyGrid([], ["L1"], [], from, to)
    const recs = recommendations(machines, rows, grid, (k) => k, new Map([["L1", 1]]))
    expect(recs.some((r) => r.type === "service" && r.machineIds[0] === "L1")).toBe(true)
  })
})

describe("restInsights", () => {
  it("measures between-set rests", () => {
    const events = [
      ev("A", "ACTIVE", d(2026, 11, 16, 17)),
      ev("A", "RESTING", d(2026, 11, 16, 17, 1)),
      ev("A", "ACTIVE", d(2026, 11, 16, 17, 3)),
      ev("A", "RESTING", d(2026, 11, 16, 17, 4)),
      ev("A", "ACTIVE", d(2026, 11, 16, 17, 8)),
      ev("A", "RESTING", d(2026, 11, 16, 17, 9)),
      ev("A", "AVAILABLE", d(2026, 11, 16, 17, 14)),
    ]
    const r = restInsights(events, deriveSessions(events))
    expect(r.betweenSets).toBe(2)
    expect(r.avgRestSeconds).toBe(180)
    expect(r.longShare).toBe(0.5)
    expect(r.buckets.find((b) => b.label === "2–3 min")!.count).toBe(1)
  })
})

describe("toCSV", () => {
  it("quotes when needed", () => {
    expect(
      toCSV([
        ["a", "b,c"],
        [1, 'say "hi"'],
      ]),
    ).toBe('a,"b,c"\r\n1,"say ""hi"""\r\n')
  })
})
