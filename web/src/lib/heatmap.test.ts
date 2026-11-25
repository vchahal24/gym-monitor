// HEATMAP TESTS
// Purpose: heatmap bucketing

import { describe, expect, it } from "vitest"
import { computeHeatmap } from "./heatmap"
import { d, ev, session } from "./testUtils"

// Sunday 22 Nov 2026, 10 pm: the whole week Mon 16 – Sun 22 has elapsed
const NOW = d(2026, 11, 22, 22, 0)
const MON = 0
const SUN = 6
const B_7_9AM = 0
const B_5_7PM = 5

describe("computeHeatmap", () => {
  it("returns the 7×7 grid with contract labels", () => {
    const h = computeHeatmap([], { machineId: "LE01", machineIds: ["LE01"], now: NOW, weeks: 1 })
    expect(h.days).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])
    expect(h.blocks).toEqual(["7-9 am", "9-11 am", "11 am-1 pm", "1-3 pm", "3-5 pm", "5-7 pm", "7-9 pm"])
    expect(h.values).toHaveLength(7)
    h.values.forEach((row) => expect(row).toEqual([0, 0, 0, 0, 0, 0, 0]))
  })

  it("counts ACTIVE and RESTING as in use, as a fraction of the block", () => {
    // Mon 5 pm: 30 min active + 30 min resting = 1 h of a 2 h block
    const events = session("LE01", d(2026, 11, 16, 17, 0), 30, 30)
    const h = computeHeatmap(events, { machineId: "LE01", machineIds: ["LE01"], now: NOW, weeks: 1 })
    expect(h.values[MON][B_5_7PM]).toBe(0.5)
    expect(h.busiest).toEqual({ day: "MON", block: "5-7 pm", value: 0.5 })
  })

  it("splits a session that spans two blocks", () => {
    // Mon 8:30–9:30 am → 30 min in 7–9 am, 30 min in 9–11 am
    const events = session("LE01", d(2026, 11, 16, 8, 30), 60, 0)
    const h = computeHeatmap(events, { machineId: "LE01", machineIds: ["LE01"], now: NOW, weeks: 1 })
    expect(h.values[MON][B_7_9AM]).toBe(0.25)
    expect(h.values[MON][1]).toBe(0.25)
  })

  it("averages over weeks", () => {
    // fully used Mon 5–7 pm one week, unused the week before → 0.5 over 2 weeks
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 16, 17)), ev("LE01", "AVAILABLE", d(2026, 11, 16, 19))]
    const h = computeHeatmap(events, { machineId: "LE01", machineIds: ["LE01"], now: NOW, weeks: 2 })
    expect(h.values[MON][B_5_7PM]).toBe(0.5)
  })

  it("averages over machines for the gym-wide (ALL) heatmap", () => {
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 16, 17)), ev("LE01", "AVAILABLE", d(2026, 11, 16, 19))]
    const h = computeHeatmap(events, { machineId: "ALL", machineIds: ["LE01", "LP01", "LC01", "SLC01"], now: NOW, weeks: 1 })
    expect(h.machineId).toBe("ALL")
    expect(h.values[MON][B_5_7PM]).toBe(0.25)
  })

  it("ignores events for machines not in the set", () => {
    const events = session("SM01", d(2026, 11, 16, 17, 0), 60, 60)
    const h = computeHeatmap(events, { machineId: "LE01", machineIds: ["LE01"], now: NOW, weeks: 1 })
    expect(h.values[MON][B_5_7PM]).toBe(0)
  })

  it("only counts elapsed time in the current block", () => {
    // Sunday 8 am, in use since 7 am → the elapsed hour was fully in use
    const now = d(2026, 11, 22, 8, 0)
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 22, 7, 0))]
    const h = computeHeatmap(events, { machineId: "LE01", machineIds: ["LE01"], now, weeks: 1 })
    expect(h.values[SUN][B_7_9AM]).toBe(1)
  })

  it("excludes maintenance time instead of counting it as unused", () => {
    // LP01 was in maintenance all of Mon 5–7 pm; LE01 was fully used
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 16, 17)), ev("LE01", "RESTING", d(2026, 11, 16, 19)), ev("LE01", "AVAILABLE", d(2026, 11, 16, 19, 5))]
    const downtime = [{ machineId: "LP01", start: d(2026, 11, 16, 12).getTime(), end: d(2026, 11, 17, 9).getTime() }]
    const h = computeHeatmap(events, { machineId: "ALL", machineIds: ["LE01", "LP01"], now: NOW, weeks: 1, downtime })
    expect(h.values[MON][B_5_7PM]).toBe(1)
    // without the exclusion it would have been 50 %
    expect(computeHeatmap(events, { machineId: "ALL", machineIds: ["LE01", "LP01"], now: NOW, weeks: 1 }).values[MON][B_5_7PM]).toBe(0.5)
  })

  it("drops in-use time that overlaps maintenance", () => {
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 16, 17)), ev("LE01", "RESTING", d(2026, 11, 16, 18, 55)), ev("LE01", "AVAILABLE", d(2026, 11, 16, 20))]
    const downtime = [{ machineId: "LE01", start: d(2026, 11, 16, 18).getTime(), end: d(2026, 11, 16, 23).getTime() }]
    const h = computeHeatmap(events, { machineId: "LE01", machineIds: ["LE01"], now: NOW, weeks: 1, downtime })
    expect(h.values[MON][B_5_7PM]).toBe(1) // 1 h used of the 1 h in service
    expect(h.values[MON][6]).toBe(0) // 7–9 pm fully in maintenance → no data, 0
  })

  it("carries a session that started before the window into it", () => {
    // window for 1 week ending Sun 22 starts Mon 16 00:00. Session began Sun 15, 11 pm
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 15, 23)), ev("LE01", "AVAILABLE", d(2026, 11, 16, 8))]
    const h = computeHeatmap(events, { machineId: "LE01", machineIds: ["LE01"], now: NOW, weeks: 1 })
    expect(h.values[MON][B_7_9AM]).toBe(0.5)
  })
})
