// MOCK DATA SOURCE TESTS
// Purpose: the mock data source end to end

import { describe, expect, it } from "vitest"
import { GYM_LAYOUT } from "../../config/gym-layout"
import { deriveSessions } from "../../lib/sessions"
import type { liveMessage } from "../../types"
import { MockDataSource } from "./MockDataSource"

// a Tuesday evening so the gym is busy
const START = new Date(2026, 10, 17, 18, 0).getTime()

describe("MockDataSource", () => {
  it("generates about four weeks of valid, ordered history for every machine", async () => {
    const ds = new MockDataSource({ now: () => START, live: false })
    const machines = await ds.getMachines()
    expect(machines.map((m) => m.id)).toEqual(GYM_LAYOUT.map((l) => l.id))
    expect(
      machines
        .filter((m) => m.prototype)
        .map((m) => m.id)
        .sort(),
    ).toEqual(["LE01", "LP01"])

    const events = await ds.getEvents("LP01", new Date(START - 28 * 86_400_000), new Date(START))
    const sessions = deriveSessions(events)
    expect(sessions.length).toBeGreaterThan(150)
    const avgWorkoutMin = sessions.reduce((s, x) => s + x.workoutSeconds, 0) / sessions.length / 60
    const avgOccupiedMin = sessions.reduce((s, x) => s + x.occupiedSeconds, 0) / sessions.length / 60
    expect(avgWorkoutMin).toBeGreaterThan(4)
    expect(avgWorkoutMin).toBeLessThan(15)
    // occupied time includes the final 5-minute timeout
    expect(avgOccupiedMin - avgWorkoutMin).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < events.length; i++) {
      expect(Date.parse(events[i].timestamp)).toBeGreaterThanOrEqual(Date.parse(events[i - 1].timestamp))
      expect(events[i].state).not.toBe(events[i - 1].state)
    }
  })

  it("has weekday-evening peaks in the gym-wide heatmap", async () => {
    const ds = new MockDataSource({ now: () => START, live: false })
    const h = await ds.getHeatmap("ALL", 4)
    const weekdayEvening = h.values.slice(0, 4).map((row) => row[5])
    const weekdayMorning = h.values.slice(0, 4).map((row) => row[0])
    weekdayEvening.forEach((v, i) => expect(v).toBeGreaterThan(weekdayMorning[i]))
    expect(["5-7 pm", "11 am-1 pm"]).toContain(h.busiest.block)
  })

  it("changes state at a realistic pace: every few seconds at peak, rarely when quiet", () => {
    function count(start: number, seconds: number) {
      let now = start
      const ds = new MockDataSource({ now: () => now, live: false })
      let n = 0
      ds.subscribe((m) => m.type === "state" && n++)
      for (let i = 0; i < seconds; i++) {
        now += 1000
        ds.tick()
      }
      return n
    }
    // Tuesday 6 pm, 20 minutes: busy, but no faster than every ~4 s on average
    const busy = count(START, 1200)
    expect(busy).toBeGreaterThan(1200 / 20)
    expect(busy).toBeLessThan(1200 / 4)
    // Sunday 10:15 pm: a handful at most
    const quiet = count(new Date(2026, 10, 22, 22, 15).getTime(), 1200)
    expect(quiet).toBeLessThan(busy / 4)
  })

  it("puts two machines in maintenance and leaves them frozen", async () => {
    let now = START
    const ds = new MockDataSource({ now: () => now, live: false })
    const inMaint = (await ds.getMachines()).filter((m) => m.maintenance)
    expect(inMaint.map((m) => m.id).sort()).toEqual(["PD01", "TM03"])
    const summary = await ds.getSummary()
    expect(summary.maintenance).toBe(2)
    expect(summary.operational).toBe(summary.total - 2)

    // no sensor events while in maintenance, even when ticking
    for (let i = 0; i < 600; i++) {
      now += 1000
      ds.tick()
    }
    for (const m of inMaint) {
      const events = await ds.getEvents(m.id, new Date(Date.parse(m.maintenance!.since)), new Date(now))
      expect(events).toEqual([])
    }
    const stats = await ds.getMachineStats("TM03")
    expect(stats.maintenanceHistory[0].end).toBeNull()
    expect(stats.maintenanceHistory.length).toBeGreaterThan(1)
  })

  it("clears maintenance and resumes the simulation", async () => {
    let now = START
    const ds = new MockDataSource({ now: () => now, live: false })
    const got: liveMessage[] = []
    ds.subscribe((m) => got.push(m))
    const m = ds.endMaintenance("PD01")
    expect(m.maintenance).toBeNull()
    expect(got[0]).toMatchObject({ type: "maintenance", machine: { id: "PD01", maintenance: null } })
    ds.applyMaintenance("LE01", { since: new Date(now).toISOString(), reason: "Test", expectedBack: null })
    expect((await ds.getMachine("LE01")).maintenance?.reason).toBe("Test")
    for (let i = 0; i < 3600; i++) {
      now += 1000
      ds.tick()
    }
    expect((await ds.getEvents("PD01", new Date(START), new Date(now))).length).toBeGreaterThan(0)
    expect(await ds.getEvents("LE01", new Date(START + 1), new Date(now))).toEqual([])
  })

  it("requires the demo admin login for maintenance changes", async () => {
    const ds = new MockDataSource({ now: () => START, live: false })
    await expect(ds.adminLogin("admin", "nope")).rejects.toThrow(/Wrong/)
    const { token } = await ds.adminLogin("admin", "gym4200")
    await expect(ds.setMaintenance("HS01", { since: new Date(START).toISOString(), reason: "Squeak", expectedBack: null }, "bad")).rejects.toThrow()
    const m = await ds.setMaintenance("HS01", { since: new Date(START).toISOString(), reason: "Squeak", expectedBack: null }, token)
    expect(m.maintenance?.reason).toBe("Squeak")
    expect((await ds.getSummary()).maintenance).toBe(3)
    expect((await ds.clearMaintenance("HS01", token)).maintenance).toBeNull()
  })

  it("demo controls force and hold a state", async () => {
    let now = START
    const ds = new MockDataSource({ now: () => now, live: false })
    ds.demo.forceState("LE01", "ACTIVE", { hold: true })
    for (let i = 0; i < 120; i++) {
      now += 1000
      ds.tick()
    }
    const m = await ds.getMachine("LE01")
    expect(m.state).toBe("ACTIVE")
    expect(m.sessionStartedAt).not.toBeNull()
    ds.demo.forceState("LE01", "AVAILABLE")
    expect((await ds.getMachine("LE01")).state).toBe("AVAILABLE")
  })
})
