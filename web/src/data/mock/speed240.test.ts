// 240x SPEED TESTS
// Purpose: the demo at 240x keeps every change in order and doesnt flood React

import { describe, expect, it } from "vitest"
import { GYM_LAYOUT } from "../../config/gym-layout"
import { RESTING_TIMEOUT_MS } from "../../config/state-machine"
import { findViolation } from "../../lib/stateMachine"
import type { liveMessage, StateEvent } from "../../types"
import { simClockClass, SPEEDS } from "../clock"
import { LiveStore } from "../LiveStore"
import { MockDataSource } from "./MockDataSource"

// Tuesday 4 pm into the evening rush, run at 240× with the real 250 ms tick:
// every tick jumps a whole simulated minute
const START = new Date(2026, 10, 17, 16, 0).getTime()
const TICK_REAL_MS = 250
const SIM_HOURS = 4
// weekday 6 pm, the busiest time
const BUSY_EVENING = new Date(2026, 10, 17, 18, 0).getTime()

describe("demo clock at 240×", () => {
  let real = START
  const clock = new simClockClass(() => real)
  clock.setSpeed(240)
  const ds = new MockDataSource({ now: clock.now, live: false, seed: 11 })
  const live: liveMessage[] = []
  ds.subscribe((m) => live.push(m))
  const ticks = (SIM_HOURS * 3600_000) / 240 / TICK_REAL_MS
  for (let i = 0; i < ticks; i++) {
    real += TICK_REAL_MS
    ds.tick()
  }
  const end = clock.now()
  const liveStates = live.filter((m): m is Extract<liveMessage, { type: "state" }> => m.type === "state").map((m) => m.event)

  it("is offered, and 5 simulated minutes take 1.25 real seconds", () => {
    expect(SPEEDS).toContain(240)
    expect(RESTING_TIMEOUT_MS / 240).toBe(1250)
    expect(end - START).toBe(SIM_HOURS * 3600_000) // no drift between real and sim time
  })

  it("sends every change live, none skipped or doubled", async () => {
    expect(liveStates.length).toBeGreaterThan(300)
    for (const l of GYM_LAYOUT) {
      const stored = (await ds.getEvents(l.id, new Date(START + 1), new Date(end))).map((e) => e.timestamp + e.state)
      const sent = liveStates.filter((e) => e.machineId === l.id).map((e) => e.timestamp + e.state)
      expect(sent, l.id).toEqual(stored)
    }
  })

  it("keeps the state machine rules, with every timeout ≥ 300 simulated s", async () => {
    let timeouts = 0
    for (const l of GYM_LAYOUT) {
      const events: StateEvent[] = await ds.getEvents(l.id, new Date(START - 86_400_000), new Date(end))
      expect(findViolation(events), l.id).toBeNull()
      for (let i = 1; i < events.length; i++) {
        if (events[i - 1].state === "RESTING" && events[i].state === "AVAILABLE") {
          timeouts++
          expect(Date.parse(events[i].timestamp) - Date.parse(events[i - 1].timestamp)).toBeGreaterThanOrEqual(RESTING_TIMEOUT_MS)
        }
      }
    }
    expect(timeouts).toBeGreaterThan(50)
  })

  it("sends each tick in time order across machines", () => {
    for (let i = 1; i < liveStates.length; i++) {
      expect(Date.parse(liveStates[i].timestamp)).toBeGreaterThanOrEqual(Date.parse(liveStates[i - 1].timestamp))
    }
  })

  it("re-renders once per tick, not once per event", async () => {
    let t = BUSY_EVENING
    const c = new simClockClass(() => t)
    c.setSpeed(240)
    const ds2 = new MockDataSource({ now: c.now, live: false, seed: 11 })
    const store = new LiveStore(ds2, c.now)
    store.start()
    await new Promise((r) => setTimeout(r, 0))
    let renders = 0
    store.subscribe(() => renders++)
    let events = 0
    ds2.subscribe((m) => m.type === "state" && events++)
    for (let i = 0; i < 40; i++) {
      t += TICK_REAL_MS
      ds2.tick()
      await Promise.resolve() // let the queued notification run
    }
    expect(events).toBeGreaterThan(40) // more than one event per tick on average…
    expect(renders).toBeLessThanOrEqual(40) // …but at most one notification per tick
    store.stop()
  })
})
