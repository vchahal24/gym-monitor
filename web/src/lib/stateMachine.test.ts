// STATE MACHINE TESTS
// Purpose: the state machine transitions and the rule checker

import { describe, expect, it } from "vitest"
import { ACTIVATION_MS, RESTING_TIMEOUT_MS } from "../config/state-machine"
import { findViolation, runStateMachine } from "./stateMachine"

const S = 1000
const T0 = Date.UTC(2026, 10, 16, 17, 0)
function mv(startS: number, endS: number) {
  return { start: T0 + startS * S, end: T0 + endS * S }
}
function at(s: number) {
  return T0 + s * S
}

describe("runStateMachine", () => {
  it("uses the agreed firmware constants", () => {
    expect(ACTIVATION_MS).toBe(3000)
    expect(RESTING_TIMEOUT_MS).toBe(300_000)
  })

  it("ignores bumps shorter than the activation time", () => {
    expect(runStateMachine([mv(0, 1), mv(10, 12.9), mv(20, 23)])).toEqual([])
  })

  it("activates after 3 s of continuous movement, rests when it stops", () => {
    expect(runStateMachine([mv(0, 40)])).toEqual([
      { state: "ACTIVE", at: at(3) },
      { state: "RESTING", at: at(40) },
    ])
  })

  it("goes AVAILABLE only after 300 s of stillness", () => {
    expect(runStateMachine([mv(0, 40)], undefined, { finish: true }).at(-1)).toEqual({ state: "AVAILABLE", at: at(340) })
    // not yet at 339 s, yes at 340 s
    expect(runStateMachine([mv(0, 40)], undefined, { until: at(339) }).map((t) => t.state)).toEqual(["ACTIVE", "RESTING"])
    expect(runStateMachine([mv(0, 40)], undefined, { until: at(340) }).at(-1)?.state).toBe("AVAILABLE")
  })

  it("returns to ACTIVE on any movement while RESTING and resets the timer", () => {
    // rest 250 s, a 1 s bump (shorter than activation still counts), then still
    const out = runStateMachine([mv(0, 40), mv(290, 291)], undefined, { finish: true })
    expect(out).toEqual([
      { state: "ACTIVE", at: at(3) },
      { state: "RESTING", at: at(40) },
      { state: "ACTIVE", at: at(290) },
      { state: "RESTING", at: at(291) },
      // 300 s after the bump, not after the first rest began
      { state: "AVAILABLE", at: at(591) },
    ])
  })

  it("ends the session if movement resumes after the timeout", () => {
    const out = runStateMachine([mv(0, 40), mv(400, 402), mv(500, 560)], undefined, { finish: true })
    expect(out.map((t) => [t.state, (t.at - T0) / S])).toEqual([
      ["ACTIVE", 3],
      ["RESTING", 40],
      ["AVAILABLE", 340],
      // 400–402 s is a bump from AVAILABLE: ignored
      ["ACTIVE", 503],
      ["RESTING", 560],
      ["AVAILABLE", 860],
    ])
  })

  it("continues from a given initial state", () => {
    expect(runStateMachine([mv(10, 20)], { state: "ACTIVE", since: at(0) })).toEqual([{ state: "RESTING", at: at(20) }])
    expect(runStateMachine([], { state: "RESTING", since: at(0) }, { finish: true })).toEqual([{ state: "AVAILABLE", at: at(300) }])
  })
})

describe("findViolation", () => {
  function e(state: "AVAILABLE" | "ACTIVE" | "RESTING", s: number) {
    return { state, timestamp: new Date(at(s)).toISOString() }
  }
  it("flags ACTIVE→AVAILABLE and early timeouts", () => {
    expect(findViolation([e("AVAILABLE", 0), e("ACTIVE", 3), e("RESTING", 40), e("AVAILABLE", 340)])).toBeNull()
    expect(findViolation([e("ACTIVE", 3), e("AVAILABLE", 40)])).toMatch(/ACTIVE→AVAILABLE/)
    expect(findViolation([e("RESTING", 3), e("AVAILABLE", 200)])).toMatch(/only 197 s/)
  })
})
