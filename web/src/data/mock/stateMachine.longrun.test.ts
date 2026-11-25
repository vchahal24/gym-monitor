// LONG RUN STATE MACHINE TESTS
// Purpose: the mocks events obey the state machine rules over a long run

import { describe, expect, it } from "vitest"
import { GYM_LAYOUT } from "../../config/gym-layout"
import { RESTING_TIMEOUT_MS } from "../../config/state-machine"
import { findViolation } from "../../lib/stateMachine"
import type { liveMessage, StateEvent } from "../../types"
import { MockDataSource } from "./MockDataSource"

// Tuesday evening: four weeks of history, then two simulated live hours
const START = new Date(2026, 10, 17, 17, 0).getTime()
const LIVE_SECONDS = 2 * 3600

describe("mock state machine over a long simulated run", () => {
  let now = START
  const ds = new MockDataSource({ now: () => now, live: false, seed: 7 })
  const live: liveMessage[] = []
  ds.subscribe((m) => live.push(m))
  for (let i = 0; i < LIVE_SECONDS; i++) {
    now += 1000
    ds.tick()
  }

  const perMachine = new Map<string, StateEvent[]>()
  const ready = Promise.all(GYM_LAYOUT.map(async (l) => perMachine.set(l.id, await ds.getEvents(l.id, new Date(0), new Date(now)))))

  it("produced a lot of activity, live and historical", async () => {
    await ready
    const total = [...perMachine.values()].reduce((n, l) => n + l.length, 0)
    expect(total).toBeGreaterThan(20_000)
    expect(live.filter((m) => m.type === "state").length).toBeGreaterThan(500)
  })

  it("never goes ACTIVE→AVAILABLE", async () => {
    await ready
    for (const [id, events] of perMachine) {
      for (let i = 1; i < events.length; i++) {
        if (events[i - 1].state === "ACTIVE" && events[i].state === "AVAILABLE") {
          throw new Error(`${id}: ACTIVE→AVAILABLE at ${events[i].timestamp}`)
        }
      }
    }
  })

  it("only goes RESTING→AVAILABLE after ≥ 300 s of RESTING", async () => {
    await ready
    let checked = 0
    for (const events of perMachine.values()) {
      for (let i = 1; i < events.length; i++) {
        if (events[i - 1].state === "RESTING" && events[i].state === "AVAILABLE") {
          expect(Date.parse(events[i].timestamp) - Date.parse(events[i - 1].timestamp)).toBeGreaterThanOrEqual(RESTING_TIMEOUT_MS)
          checked++
        }
      }
      expect(findViolation(events)).toBeNull()
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it("resets the resting timer on RESTING→ACTIVE", async () => {
    await ready
    // find rests that were interrupted by movement: had the timer not reset,
    // total stillness since the *first* rest began would already have timed
    // out before the machine went AVAILABLE
    let resets = 0
    for (const events of perMachine.values()) {
      for (let i = 3; i < events.length; i++) {
        const [r1, a, r2, av] = events.slice(i - 3, i + 1)
        if (r1.state !== "RESTING" || a.state !== "ACTIVE" || r2.state !== "RESTING" || av.state !== "AVAILABLE") continue
        const sinceFirstRest = Date.parse(av.timestamp) - Date.parse(r1.timestamp)
        const sinceLastRest = Date.parse(av.timestamp) - Date.parse(r2.timestamp)
        expect(sinceLastRest).toBeGreaterThanOrEqual(RESTING_TIMEOUT_MS)
        if (sinceFirstRest > RESTING_TIMEOUT_MS + 1000) resets++
      }
    }
    expect(resets).toBeGreaterThan(50)
  })

  it("keeps sessions continuous across normal 1–3 min rests", async () => {
    await ready
    const rests: number[] = []
    for (const events of perMachine.values()) {
      for (let i = 1; i < events.length; i++) {
        if (events[i - 1].state === "RESTING" && events[i].state === "ACTIVE") {
          rests.push(Date.parse(events[i].timestamp) - Date.parse(events[i - 1].timestamp))
        }
      }
    }
    rests.forEach((r) => expect(r).toBeLessThan(RESTING_TIMEOUT_MS))
    const typical = rests.filter((r) => r >= 60_000 && r <= 180_000).length / rests.length
    expect(typical).toBeGreaterThan(0.5)
  })
})
