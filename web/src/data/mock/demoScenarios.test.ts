// DEMO SCENARIO TESTS
// Purpose: every demo panel scenario does what it says

import { describe, expect, it } from "vitest"
import { RESTING_TIMEOUT_MS } from "../../config/state-machine"
import { simClockClass } from "../clock"
import { MockDataSource } from "./MockDataSource"

const START = new Date(2026, 10, 17, 10, 0).getTime() // Tuesday 10 am

function setup() {
  let real = START
  const clock = new simClockClass(() => real)
  const ds = new MockDataSource({ now: clock.now, live: false })
  function step(ms: number) {
    real += ms
    ds.tick()
  }
  return { ds, clock, step }
}

describe("demo scenarios (mock)", () => {
  it('"LP01 resting → leaves" frees the machine exactly after the timeout', async () => {
    const { ds, step } = setup()
    ds.demo.startSession("LP01")
    step(30_000)
    ds.demo.leave("LP01")
    const m = await ds.getMachine("LP01")
    expect(m.state).toBe("RESTING")
    step(RESTING_TIMEOUT_MS - 1000)
    expect((await ds.getMachine("LP01")).state).toBe("RESTING")
    step(2000)
    expect((await ds.getMachine("LP01")).state).toBe("AVAILABLE")
  })

  it("runs the simulation faster with the sim clock (60×)", async () => {
    const { ds, clock, step } = setup()
    ds.demo.leave("LP01")
    clock.setSpeed(60)
    step(5_000) // 5 real seconds = 5 sim minutes
    step(1_000)
    expect((await ds.getMachine("LP01")).state).toBe("AVAILABLE")
  })

  it("evening rush fills the gym; quiet morning empties it", async () => {
    const { ds, step } = setup()
    const started = ds.demo.rush()
    expect(started).toBeGreaterThan(10)
    const busy = (await ds.getMachines()).filter((m) => !m.maintenance && m.state !== "AVAILABLE").length
    expect(busy).toBeGreaterThan(15)
    ds.demo.quiet(60)
    for (let i = 0; i < 12; i++) step(30_000)
    // 6 min later: everyone has timed out and nobody new has arrived
    // offline nodes keep their last known state
    const left = (await ds.getMachines()).filter((m) => m.online && m.state !== "AVAILABLE")
    expect(left.map((m) => [m.id, m.online, !!m.maintenance])).toEqual([])
  })

  it("a node going offline and a treadmill breaking work without login", async () => {
    const { ds } = setup()
    ds.demo.setOnline("LE01", false)
    expect((await ds.getMachine("LE01")).online).toBe(false)
    ds.demo.setMaintenance("TM01", "Belt snapped")
    expect((await ds.getMachine("TM01")).maintenance?.reason).toBe("Belt snapped")
    expect((await ds.getSummary()).maintenance).toBe(3)
    ds.demo.setMaintenance("TM01", null)
    expect((await ds.getMachine("TM01")).maintenance).toBeNull()
  })
})
