// CLOCK TESTS
// Purpose: the demo sim clock, speed, pause and reset

import { describe, expect, it } from "vitest"
import { simClockClass } from "./clock"

describe("simClockClass", () => {
  it("runs at the chosen speed, pauses and resets", () => {
    let real = 1_000_000
    const c = new simClockClass(() => real)
    real += 1000
    expect(c.now()).toBe(1_001_000)
    c.setSpeed(60)
    real += 1000
    expect(c.now()).toBe(1_061_000)
    c.setPaused(true)
    real += 5000
    expect(c.now()).toBe(1_061_000)
    c.setPaused(false)
    real += 1000
    expect(c.now()).toBe(1_121_000)
    c.reset()
    expect(c.now()).toBe(real)
    expect(c.getState()).toEqual({ speed: 1, paused: false })
  })
})
