// DETAIL PAGE TESTS
// Purpose: utilisation, ranks, hourly occupancy, best times, alternatives and the histogram

import { describe, expect, it } from "vitest"
import type { Machine } from "../types"
import { alternativeHint, alternativesFor } from "./alternatives"
import { quietestUpcomingBlocks } from "./bestTimes"
import { CHART_HOURS, hourlyOccupancy, typicalHourly } from "./hourly"
import { fleetUtilisation, inUseIntervals, rankByValue, utilisationRates } from "./utilisation"
import { d, ev } from "./testUtils"

describe("utilisationRates", () => {
  const now = d(2026, 11, 22, 21, 0) // Sunday 9 pm: todays opening hours (14 h) are over
  it("is occupied time over 7 am – 9 pm opening time", () => {
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 22, 9)), ev("LE01", "RESTING", d(2026, 11, 22, 12)), ev("LE01", "AVAILABLE", d(2026, 11, 22, 12, 30))]
    const r = utilisationRates(events, "LE01", now)
    expect(r.today).toBeCloseTo(3.5 / 14)
    expect(r.week).toBeCloseTo(3.5 / (14 * 7))
    expect(r.fourWeeks).toBeCloseTo(3.5 / (14 * 28))
  })

  it("leaves maintenance time out of the denominator", () => {
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 22, 7)), ev("LE01", "RESTING", d(2026, 11, 22, 14)), ev("LE01", "AVAILABLE", d(2026, 11, 22, 14, 5))]
    const downtime = [{ machineId: "LE01", start: d(2026, 11, 22, 14, 5).getTime(), end: d(2026, 11, 23).getTime() }]
    expect(utilisationRates(events, "LE01", now, downtime).today).toBeCloseTo(1)
  })
})

describe("rankByValue / fleetUtilisation", () => {
  it("ranks busiest first and shares ties", () => {
    expect([
      ...rankByValue(
        new Map([
          ["a", 0.2],
          ["b", 0.5],
          ["c", 0.2],
        ]),
      ),
    ]).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 2],
    ])
  })

  it("averages per group", () => {
    const now = d(2026, 11, 22, 21)
    const events = [ev("A", "ACTIVE", d(2026, 11, 22, 7)), ev("A", "RESTING", d(2026, 11, 22, 20, 55)), ev("A", "AVAILABLE", d(2026, 11, 23))]
    const f = fleetUtilisation(
      events,
      [
        { id: "A", group: "legs" },
        { id: "B", group: "legs" },
      ],
      now,
    )
    expect(f.rank.get("A")).toBe(1)
    expect(f.groupAvg.get("legs")).toBeCloseTo(f.rates.get("A")!.fourWeeks / 2)
  })
})

describe("hourly occupancy", () => {
  it("splits a day into hours and stops at now", () => {
    const now = d(2026, 11, 22, 8, 30)
    const events = [ev("LE01", "ACTIVE", d(2026, 11, 22, 6, 30)), ev("LE01", "RESTING", d(2026, 11, 22, 7, 0)), ev("LE01", "AVAILABLE", d(2026, 11, 22, 7, 15))]
    const iv = inUseIntervals(events, "LE01", d(2026, 11, 22).getTime(), now.getTime())
    const h = hourlyOccupancy(iv, [], now, now.getTime())
    expect(h[CHART_HOURS.indexOf(6)]).toBeCloseTo(0.5)
    expect(h[CHART_HOURS.indexOf(7)]).toBeCloseTo(0.25)
    expect(h[CHART_HOURS.indexOf(8)]).toBe(0)
    expect(h[CHART_HOURS.indexOf(9)]).toBeNull()
  })

  it("averages the same weekday over previous weeks", () => {
    const now = d(2026, 11, 22, 12)
    // two Sundays ago 6–7 am fully used, last Sunday unused
    const events = [
      ev("LE01", "AVAILABLE", d(2026, 10, 20)),
      ev("LE01", "ACTIVE", d(2026, 11, 8, 6)),
      ev("LE01", "RESTING", d(2026, 11, 8, 6, 55)),
      ev("LE01", "AVAILABLE", d(2026, 11, 8, 7)),
    ]
    const iv = inUseIntervals(events, "LE01", d(2026, 10, 20).getTime(), now.getTime())
    expect(typicalHourly(iv, [], now, 2)[0]).toBeCloseTo(0.5)
  })
})

describe("quietestUpcomingBlocks", () => {
  const values = Array.from({ length: 7 }, (_, day) => Array.from({ length: 7 }, (_, b) => (day * 7 + b) / 49))
  it("picks the quietest blocks still ahead this week", () => {
    // Saturday 10 am: blocks left are Sat 11 am.. and Sun
    const r = quietestUpcomingBlocks({ values }, d(2026, 11, 21, 10, 0))
    expect(r.map((x) => [x.day, x.block])).toEqual([
      [5, 1],
      [5, 2],
      [5, 3],
    ])
  })

  it("rolls into next week when the week is nearly over", () => {
    const r = quietestUpcomingBlocks({ values }, d(2026, 11, 22, 19, 45))
    expect(r[0]).toMatchObject({ day: 6, block: 6, nextWeek: false })
    expect(r[1]).toMatchObject({ day: 0, block: 0, nextWeek: true })
  })
})

describe("alternatives", () => {
  function m(id: string, kind: Machine["kind"], state: Machine["state"], group: Machine["group"] = "legs", maint = false): Machine {
    return {
      id,
      name: id,
      zoneId: group,
      group,
      kind,
      state,
      since: "",
      sessionStartedAt: null,
      online: true,
      lastHeartbeat: null,
      override: null,
      maintenance: maint ? { since: "", reason: "", expectedBack: null } : null,
    }
  }
  it("lists same-group operational machines, same kind first, free first", () => {
    const me = m("LP", "leg-press", "ACTIVE")
    const all = [
      me,
      m("HS", "hack-squat", "AVAILABLE"),
      m("LP2", "leg-press", "ACTIVE"),
      m("X", "leg-curl", "RESTING", "legs", true),
      m("C", "chest-press", "AVAILABLE", "chest-shoulders-triceps"),
    ]
    const alts = alternativesFor(me, all)
    expect(alts.map((a) => a.machine.id)).toEqual(["LP2", "HS"])
    expect(alternativeHint(me, alts)).toBe("LP is busy, but HS is free")
    expect(alternativeHint(m("LP", "leg-press", "AVAILABLE"), alts)).toBeNull()
  })
})

describe("histogram", () => {
  it("bins with a nice width and folds outliers into the last bin", async () => {
    const { histogram } = await import("./histogram")
    const values = [...Array.from({ length: 20 }, (_, i) => i * 15), 5000] // 0..285 s, plus one outlier
    const bins = histogram(values, [60, 120, 300], 6)
    expect(bins).toHaveLength(5)
    expect(bins[0]).toEqual({ from: 0, to: 60, count: 4 })
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(values.length)
    expect(bins.at(-1)!.count).toBeGreaterThanOrEqual(1)
    expect(histogram([], [60])).toEqual([])
  })
})

describe("header clock", () => {
  it("formats weekday, date and 12-hour time", async () => {
    const { formatClockLine } = await import("./format")
    expect(formatClockLine(new Date(2026, 10, 23, 21, 4))).toBe("Mon 23 Nov 2026 · 9:04 pm")
    expect(formatClockLine(new Date(2026, 10, 23, 0, 30))).toBe("Mon 23 Nov 2026 · 12:30 am")
    expect(formatClockLine(new Date(2026, 10, 22, 12, 0))).toBe("Sun 22 Nov 2026 · 12:00 pm")
  })
})
