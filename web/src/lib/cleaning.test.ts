// CLEANING TESTS
// Purpose: zone load, the cleaning schedule and cleaning notifications

import { describe, expect, it } from "vitest"
import { CLEAN_HOURS, cleaningSchedule, expectedZoneLoad, loadSince, todaysCleaning, zoneAlert, zoneLoads } from "./cleaning"
import { buildNotifications, sessionsSinceService } from "./notifications"
import { d } from "./testUtils"
import type { Machine, StateEvent } from "../types"

function ev(machineId: string, state: StateEvent["state"], t: Date): StateEvent {
  return { machineId, state, timestamp: t.toISOString() }
}
const machines = [
  { id: "A", zoneId: "legs" },
  { id: "B", zoneId: "legs" },
  { id: "C", zoneId: "cardio" },
]

describe("zone load", () => {
  // A: two sessions (9:00–9:20, 10:00–10:30), C: one (9:00–10:00)
  const events = [
    ev("A", "AVAILABLE", d(2026, 11, 23, 6)),
    ev("A", "ACTIVE", d(2026, 11, 23, 9)),
    ev("A", "RESTING", d(2026, 11, 23, 9, 15)),
    ev("A", "AVAILABLE", d(2026, 11, 23, 9, 20)),
    ev("A", "ACTIVE", d(2026, 11, 23, 10)),
    ev("A", "AVAILABLE", d(2026, 11, 23, 10, 30)),
    ev("C", "ACTIVE", d(2026, 11, 23, 9)),
    ev("C", "AVAILABLE", d(2026, 11, 23, 10)),
  ]
  const now = d(2026, 11, 23, 12).getTime()

  it("counts sessions started and occupied minutes since the last clean", () => {
    expect(loadSince(events, new Set(["A"]), d(2026, 11, 23, 6).getTime(), now)).toEqual({ sessions: 2, occupiedMinutes: 50 })
    // cleaned at 9:10: A's first session started before, but its last 10 min count
    expect(loadSince(events, new Set(["A"]), d(2026, 11, 23, 9, 10).getTime(), now)).toEqual({ sessions: 1, occupiedMinutes: 40 })
  })

  it("reports each zone and flags those over the threshold", () => {
    const z = zoneLoads(
      events,
      machines,
      new Map([
        ["legs", d(2026, 11, 23, 6).getTime()],
        ["cardio", d(2026, 11, 23, 6).getTime()],
      ]),
      now,
    )
    expect(z).toEqual([
      { zoneId: "legs", lastCleaned: d(2026, 11, 23, 6).toISOString(), sessionsSince: 2, occupiedMinutesSince: 50 },
      { zoneId: "cardio", lastCleaned: d(2026, 11, 23, 6).toISOString(), sessionsSince: 1, occupiedMinutesSince: 60 },
    ])
    expect(zoneAlert(z[0]).over).toBe(false)
    expect(zoneAlert({ ...z[0], sessionsSince: 52 })).toMatchObject({ over: true, reason: "sessions" })
    expect(zoneAlert({ ...z[1], occupiedMinutesSince: 2000 })).toMatchObject({ over: true, reason: "minutes" })
  })

  it("averages expected load per weekday and hour over the past weeks", () => {
    const past = [ev("A", "ACTIVE", d(2026, 11, 16, 18)), ev("A", "AVAILABLE", d(2026, 11, 16, 19, 30))] // Monday the week before
    const grid = expectedZoneLoad(past, machines, d(2026, 11, 23, 12), 1).get("legs")!
    expect(grid[0][CLEAN_HOURS.indexOf(18)]).toBeCloseTo(1)
    expect(grid[0][CLEAN_HOURS.indexOf(19)]).toBeCloseTo(0.5)
    expect(grid[1].every((v) => v === 0)).toBe(true)
  })
})

describe("cleaning schedule", () => {
  // evening rush 5–8 pm every day, a quiet morning, 4 am weekend nothing special
  const profile = CLEAN_HOURS.map((h) => (h >= 17 && h < 20 ? 20 : h >= 7 && h < 10 ? 6 : 3))
  const byZone = new Map([
    ["legs", Array.from({ length: 7 }, () => profile.map((v) => v * 0.7))],
    ["cardio", Array.from({ length: 7 }, () => profile.map((v) => v * 0.3))],
  ])
  const plan = cleaningSchedule(byZone)

  it("sends cleaners right after the rush and just before it", () => {
    const mon = plan.slots.filter((s) => s.day === 0)
    const after = mon.find((s) => s.kind === "after-peak")!
    expect(after.hour).toBeGreaterThanOrEqual(20)
    expect(after.hour).toBeLessThanOrEqual(22)
    expect(mon.find((s) => s.kind === "before-peak")!.hour).toBe(16)
    expect(after.zones[0].zoneId).toBe("legs")
  })

  it("never leaves a long stretch without a visit", () => {
    const hours = [5, ...plan.slots.filter((s) => s.day === 0).map((s) => s.hour), 23]
    for (let i = 1; i < hours.length; i++) expect(hours[i] - hours[i - 1]).toBeLessThanOrEqual(6)
  })

  it("sizes cleaner-hours by the load since the previous visit", () => {
    const mon = plan.slots.filter((s) => s.day === 0)
    const after = mon.find((s) => s.kind === "after-peak")!
    const lightest = mon.reduce((a, b) => (a.loadMachineHours < b.loadMachineHours ? a : b))
    expect(after.cleanerHours).toBeGreaterThan(lightest.cleanerHours)
    for (const s of plan.slots) expect(s.cleanerHours).toBeGreaterThanOrEqual(0.5)
  })

  it("puts deep cleans in the quietest windows on different days", () => {
    expect(plan.deep).toHaveLength(2)
    expect(new Set(plan.deep.map((x) => x.day)).size).toBe(2)
    for (const x of plan.deep) expect(x.load).toBeLessThanOrEqual(6.01)
  })

  it("lists today's visits with their status", () => {
    const t = todaysCleaning(plan, d(2026, 11, 23, 16, 30)) // Monday
    expect(t.slots.find((s) => s.hour === 16)!.status).toBe("now")
    expect(t.slots.find((s) => s.kind === "after-peak")!.status).toBe("upcoming")
    expect(t.slots.filter((s) => s.hour < 16).every((s) => s.status === "done")).toBe(true)
  })
})

describe("notifications", () => {
  const now = d(2026, 11, 23, 18).getTime()
  const base: Machine = {
    id: "LE01",
    name: "Leg Extension",
    zoneId: "legs",
    group: "legs",
    kind: "leg-extension",
    state: "AVAILABLE",
    since: d(2026, 11, 23, 17).toISOString(),
    sessionStartedAt: null,
    maintenance: null,
    override: null,
    online: true,
    lastHeartbeat: d(2026, 11, 23, 18).toISOString(),
  }

  it("raises cleaning, offline and long-hold alerts with stable ids", () => {
    const list = buildNotifications({
      now,
      zones: [{ zoneId: "legs", lastCleaned: d(2026, 11, 23, 8).toISOString(), sessionsSince: 52, occupiedMinutesSince: 300 }],
      zoneNames: new Map([["legs", "Legs"]]),
      machines: [
        { ...base, id: "BC01", name: "Preacher Curl", online: false, lastHeartbeat: d(2026, 11, 23, 17, 35).toISOString() },
        { ...base, id: "LP01", name: "Seated Leg Press", state: "ACTIVE", override: { mode: "hold", by: "admin", at: d(2026, 11, 23, 15).toISOString() } },
        { ...base, id: "LC01", override: { mode: "hold", by: "admin", at: d(2026, 11, 23, 17, 30).toISOString() } },
      ],
    })
    expect(list.map((n) => n.kind).sort()).toEqual(["cleaning", "hold", "offline"])
    expect(list.find((n) => n.kind === "cleaning")!.title).toBe("Legs zone: 52 sessions since last clean, schedule a wipe-down")
    expect(list.find((n) => n.kind === "offline")!.detail).toMatch(/25 min/)
    expect(list.find((n) => n.kind === "hold")!).toMatchObject({ id: `hold:LP01:${d(2026, 11, 23, 15).toISOString()}`, href: "/admin/machine-control" })
  })

  it("counts sessions since the last service", () => {
    const events = [
      ev("LE01", "ACTIVE", d(2026, 11, 1, 9)),
      ev("LE01", "AVAILABLE", d(2026, 11, 1, 9, 30)),
      ev("LE01", "ACTIVE", d(2026, 11, 10, 9)),
      ev("LE01", "RESTING", d(2026, 11, 10, 9, 5)),
      ev("LE01", "ACTIVE", d(2026, 11, 10, 9, 6)),
      ev("LE01", "AVAILABLE", d(2026, 11, 10, 9, 30)),
    ]
    const maint = new Map([["LE01", [{ since: d(2026, 11, 5, 9).toISOString(), end: d(2026, 11, 5, 12).toISOString(), reason: "x", expectedBack: null }]]])
    expect(sessionsSinceService(events, maint).get("LE01")).toEqual({ count: 1, since: d(2026, 11, 5, 12).toISOString() })
    expect(sessionsSinceService(events, new Map()).get("LE01")!.count).toBe(2)
  })
})
