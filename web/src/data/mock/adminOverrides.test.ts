// ADMIN OVERRIDE TESTS
// Purpose: mock admin overrides, auth and zone cleaning

import { describe, expect, it } from "vitest"
import { AuthError } from "../DataSource"
import type { liveMessage } from "../../types"
import { MockDataSource } from "./MockDataSource"

const START = new Date(2026, 10, 17, 18, 0).getTime()

async function setup() {
  let now = START
  const ds = new MockDataSource({ now: () => now, live: false })
  const { token } = await ds.adminLogin("admin", "gym4200")
  const msgs: liveMessage[] = []
  ds.subscribe((m) => msgs.push(m))
  return { ds, token, msgs, advance: (ms: number) => ((now += ms), ds.tick()) }
}

describe("admin overrides (mock)", () => {
  it("rejects override calls without a valid admin token", async () => {
    const { ds } = await setup()
    for (const bad of ["", "nope", "mock-", "Bearer x"]) {
      await expect(ds.setOverride("LE01", "ACTIVE", "hold", bad)).rejects.toBeInstanceOf(AuthError)
      await expect(ds.releaseOverride("LE01", bad)).rejects.toBeInstanceOf(AuthError)
      await expect(ds.getOverrides(bad)).rejects.toBeInstanceOf(AuthError)
      await expect(ds.getZones(bad)).rejects.toBeInstanceOf(AuthError)
      await expect(ds.markZoneCleaned("legs", bad)).rejects.toBeInstanceOf(AuthError)
    }
    expect((await ds.getMachine("LE01")).override).toBeNull()
  })

  it('"hold" pins the state until released, and is pushed to every client', async () => {
    const { ds, token, msgs, advance } = await setup()
    const m = await ds.setOverride("LP01", "ACTIVE", "hold", token)
    expect(m).toMatchObject({ state: "ACTIVE", override: { mode: "hold", by: "admin" } })
    expect(msgs.some((x) => x.type === "override" && x.machine.id === "LP01" && x.machine.override?.mode === "hold")).toBe(true)
    for (let i = 0; i < 30; i++) advance(60_000)
    expect((await ds.getMachine("LP01")).state).toBe("ACTIVE")
    const released = await ds.releaseOverride("LP01", token)
    expect(released.override).toBeNull()
    for (let i = 0; i < 60; i++) advance(60_000)
    // back under simulation: the session winds down and the machine frees up
    const events = await ds.getEvents("LP01", new Date(START), new Date(START + 91 * 60_000))
    expect(events.length).toBeGreaterThan(2)
  })

  it('"one-off" sets the state and the simulation carries on from it', async () => {
    const { ds, token, advance } = await setup()
    const before = await ds.getMachine("HS01")
    const m = await ds.setOverride("HS01", "RESTING", "one-off", token)
    expect(m.override?.mode).toBe("one-off")
    // RESTING → AVAILABLE after the 5-minute timeout, and the one-off marker clears
    for (let i = 0; i < 6; i++) advance(60_000)
    const after = await ds.getMachine("HS01")
    expect(["AVAILABLE", "ACTIVE"]).toContain(after.state)
    expect(after.override).toBeNull()
    const log = await ds.getOverrides(token)
    expect(log[0]).toMatchObject({ machineId: "HS01", from: before.state, to: "RESTING", mode: "one-off", by: "admin" })
  })

  it("never emits ACTIVE → AVAILABLE, even for an override", async () => {
    const { ds, token, msgs } = await setup()
    await ds.setOverride("CP01", "ACTIVE", "one-off", token)
    msgs.length = 0
    await ds.setOverride("CP01", "AVAILABLE", "hold", token)
    const states = msgs.flatMap((x) => (x.type === "state" && x.event.machineId === "CP01" ? [x.event.state] : []))
    expect(states).toEqual(["RESTING", "AVAILABLE"])
  })

  it("refuses overrides on a machine in maintenance", async () => {
    const { ds, token } = await setup()
    await expect(ds.setOverride("TM03", "ACTIVE", "hold", token)).rejects.toThrow(/maintenance/)
  })
})

describe("zones (mock)", () => {
  it("reports load since the last clean and resets it when marked cleaned", async () => {
    const { ds, token, advance } = await setup()
    const zones = await ds.getZones(token)
    expect(zones.map((z) => z.zoneId).sort()).toEqual(["back-biceps", "cardio", "chest-shoulders-triceps", "legs"])
    const legs = zones.find((z) => z.zoneId === "legs")!
    expect(legs.sessionsSince).toBeGreaterThan(10)
    expect(legs.occupiedMinutesSince).toBeGreaterThan(60)
    const cleaned = await ds.markZoneCleaned("legs", token)
    expect(cleaned).toMatchObject({ sessionsSince: 0, occupiedMinutesSince: 0, lastCleaned: new Date(START).toISOString() })
    for (let i = 0; i < 30; i++) advance(60_000)
    expect((await ds.getZones(token)).find((z) => z.zoneId === "legs")!.occupiedMinutesSince).toBeGreaterThan(0)
  })
})
