// MOCK REALISM TESTS
// Purpose: the mock traffic looks like a real gym (session lengths, hours, contrast)

import { describe, expect, it } from "vitest"
import { GYM_LAYOUT } from "../../config/gym-layout"
import { isOpenAt } from "../../config/gym-hours"
import { hourlyOccupancy, typicalHourly } from "../../lib/hourly"
import { deriveSessions } from "../../lib/sessions"
import { addDays, startOfDay } from "../../lib/time"
import { inUseIntervals } from "../../lib/utilisation"
import type { Session } from "../../types"
import { CARDIO_KINDS } from "./simulation"
import { MockDataSource } from "./MockDataSource"

const KIND = new Map(GYM_LAYOUT.map((l) => [l.id, l.kind]))
function isCardio(s: Session) {
  return CARDIO_KINDS.has(KIND.get(s.machineId)!)
}
function avgMin(list: Session[]) {
  return list.reduce((a, s) => a + s.workoutSeconds, 0) / list.length / 60
}

// Monday 23 Nov 2026, 5 pm: weekday evening peak
const MON_5PM = new Date(2026, 10, 23, 17, 0).getTime()
const PROTO = GYM_LAYOUT.find((l) => l.prototype && l.kind === "leg-press")!.id

describe("session lengths (bug: average session showed ~18 s)", () => {
  it("history: weights 8–20 min, cardio 15–40 min of workout time", async () => {
    const ds = new MockDataSource({ now: () => MON_5PM, live: false })
    const sessions = deriveSessions(await ds.getEvents("ALL", new Date(MON_5PM - 28 * 86_400_000), new Date(MON_5PM)))
    const weights = sessions.filter((s) => !isCardio(s))
    const cardio = sessions.filter(isCardio)
    expect(avgMin(weights)).toBeGreaterThan(8)
    expect(avgMin(weights)).toBeLessThan(20)
    expect(avgMin(cardio)).toBeGreaterThan(15)
    expect(avgMin(cardio)).toBeLessThan(40)
  })

  it("live: sessions generated while ticking are just as long (no time compression)", async () => {
    let now = MON_5PM
    const ds = new MockDataSource({ now: () => now, live: false })
    for (let i = 0; i < 90 * 60; i++) {
      now += 1000
      ds.tick()
    }
    const live = deriveSessions(await ds.getEvents("ALL", new Date(MON_5PM - 3_600_000), new Date(now))).filter(
      (s) => Date.parse(s.start) >= MON_5PM && !isCardio(s),
    )
    expect(live.length).toBeGreaterThan(20)
    expect(avgMin(live)).toBeGreaterThan(8)
    const summary = await ds.getSummary()
    expect(summary.avgWorkoutSecondsToday).toBeGreaterThan(8 * 60)
  })
})

describe('machine page "today" (bug: today was empty)', () => {
  it("history runs right up to now and today has activity during opening hours", async () => {
    const at3pm = new Date(2026, 10, 23, 15, 0).getTime()
    const ds = new MockDataSource({ now: () => at3pm, live: false })
    const events = await ds.getEvents(PROTO, new Date(at3pm - 29 * 86_400_000), new Date(at3pm))
    const last = Date.parse(events[events.length - 1].timestamp)
    expect(at3pm - last).toBeLessThan(60 * 60_000)

    const stats = await ds.getMachineStats(PROTO)
    expect(stats.utilisation.today).toBeGreaterThan(0.05)

    const from = addDays(startOfDay(new Date(at3pm)), -28).getTime()
    const intervals = inUseIntervals(events, PROTO, from, at3pm)
    const today = hourlyOccupancy(intervals, [], new Date(at3pm), at3pm)
    expect(today.filter((v) => v !== null && v > 0).length).toBeGreaterThan(3)
    // the typical line comes from 4 weeks of history: never all zeros
    const typical = typicalHourly(intervals, [], new Date(at3pm))
    expect(Math.max(...typical.map((v) => v ?? 0))).toBeGreaterThan(0.2)
  })

  it("works the same in other time zones offsets (weekday index is Monday = 0)", async () => {
    // Sunday late morning: the weekend profile, so the weekday index must be right
    const sun11 = new Date(2026, 10, 22, 11, 30).getTime()
    const ds = new MockDataSource({ now: () => sun11, live: false })
    const h = await ds.getHeatmap("ALL", 4)
    // Sunday (index 6) late morning busier than Sunday 7–9 am
    expect(h.values[6][2]).toBeGreaterThan(h.values[6][0])
    expect((await ds.getMachineStats(PROTO)).utilisation.today).toBeGreaterThan(0)
  })
})

describe("opening hours", () => {
  it("produces no activity while the gym is closed", async () => {
    const ds = new MockDataSource({ now: () => MON_5PM, live: false })
    const events = await ds.getEvents("ALL", new Date(MON_5PM - 28 * 86_400_000), new Date(MON_5PM))
    const closed = events.filter((e) => !isOpenAt(Date.parse(e.timestamp)))
    expect(closed).toEqual([])
  })

  it("stays quiet overnight when ticking live", async () => {
    let now = new Date(2026, 10, 23, 23, 0).getTime()
    const ds = new MockDataSource({ now: () => now, live: false })
    let n = 0
    ds.subscribe((m) => m.type === "state" && n++)
    for (let i = 0; i < 3 * 3600; i++) {
      now += 1000
      ds.tick()
    }
    expect(n).toBe(0)
  })
})

describe("traffic contrast", () => {
  const ds = new MockDataSource({ now: () => MON_5PM, live: false })

  it("peaks at 70–80% gym-wide on weekday evenings, quieter on Friday evening", async () => {
    const h = await ds.getHeatmap("ALL", 4)
    const monThu = h.values.slice(0, 4).map((row) => row[5])
    for (const v of monThu) {
      expect(v).toBeGreaterThan(0.65)
      expect(v).toBeLessThan(0.82)
    }
    const avg = monThu.reduce((a, b) => a + b, 0) / 4
    expect(h.values[4][5]).toBeLessThan(avg - 0.05)
    // weekends: late morning beats early morning and evening
    for (const day of [5, 6]) {
      expect(h.values[day][2]).toBeGreaterThan(h.values[day][0] + 0.2)
      expect(h.values[day][2]).toBeGreaterThan(h.values[day][6] + 0.2)
    }
    // early mornings and late evenings are quiet on weekdays
    expect(h.values[1][0]).toBeLessThan(0.35)
  })

  it("spreads machines from ~25% to ~85% at the weekday peak", async () => {
    const peaks = await Promise.all(
      GYM_LAYOUT.map(async (l) => {
        const h = await ds.getHeatmap(l.id, 4)
        return h.values.slice(0, 4).reduce((a, row) => a + row[5], 0) / 4
      }),
    )
    expect(Math.min(...peaks)).toBeLessThan(0.35)
    expect(Math.max(...peaks)).toBeGreaterThan(0.78)
    expect(Math.max(...peaks)).toBeLessThan(0.92)
  })

  it("adds week-to-week noise (the same weekday differs between weeks)", async () => {
    const stats = await ds.getMachineStats(PROTO)
    const mondays = stats.sessionsPerDay.filter((d) => new Date(`${d.date}T12:00`).getDay() === 1).map((d) => d.count)
    expect(new Set(mondays).size).toBeGreaterThan(1)
  })
})
