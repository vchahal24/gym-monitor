// GYM HOURS TESTS
// Purpose: opening / closing times and the open status line

import { describe, expect, it } from "vitest"
import { d } from "../lib/testUtils"
import { hourLabel, isOpenAt, nextOpening, openStatus } from "./gym-hours"

describe("gym hours", () => {
  it("is open 6 am – 11 pm", () => {
    expect(isOpenAt(d(2026, 11, 23, 5, 59))).toBe(false)
    expect(isOpenAt(d(2026, 11, 23, 6, 0))).toBe(true)
    expect(isOpenAt(d(2026, 11, 23, 22, 59))).toBe(true)
    expect(isOpenAt(d(2026, 11, 23, 23, 0))).toBe(false)
  })

  it("finds the next opening", () => {
    expect(nextOpening(d(2026, 11, 23, 2)).getTime()).toBe(d(2026, 11, 23, 6).getTime())
    expect(nextOpening(d(2026, 11, 23, 23, 30)).getTime()).toBe(d(2026, 11, 24, 6).getTime())
  })

  it("describes the status", () => {
    expect(openStatus(d(2026, 11, 23, 10))).toEqual({ open: true, text: "Open until 11 pm" })
    expect(openStatus(d(2026, 11, 23, 3)).text).toBe("Gym closed, opens 6 am")
    expect(openStatus(d(2026, 11, 23, 23, 15)).text).toBe("Gym closed, opens 6 am tomorrow")
    expect(hourLabel(0)).toBe("12 am")
    expect(hourLabel(23)).toBe("11 pm")
  })
})
