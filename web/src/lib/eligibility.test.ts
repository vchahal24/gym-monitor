// ELIGIBILITY TESTS
// Purpose: what counts for live and history figures, offline and maintenance

import { describe, expect, it } from "vitest"
import { MockDataSource } from "../data/mock/MockDataSource"
import type { Machine, MachineState } from "../types"
import { countsForHistory, countsForLiveStats, currentExclusions, displayStatus, historyExclusions, liveCounts, reportingLine } from "./eligibility"
import { computeHeatmap } from "./heatmap"
import { busiestBlockToday, computeSummary } from "./summary"
import { d, ev, session } from "./testUtils"
import { fleetUtilisation, utilisationBetween, inUseIntervals } from "./utilisation"

function m(id: string, state: MachineState, opts: { online?: boolean; maintenance?: boolean; lastHeartbeat?: string } = {}): Machine {
  return {
    id,
    name: id,
    zoneId: "legs",
    group: "legs",
    kind: "leg-press",
    state,
    since: "",
    sessionStartedAt: null,
    online: opts.online ?? true,
    lastHeartbeat: opts.lastHeartbeat ?? null,
    override: null,
    maintenance: opts.maintenance ? { since: d(2026, 11, 23, 8).toISOString(), reason: "x", expectedBack: null } : null,
  }
}

describe("display status and live eligibility", () => {
  it("ranks MAINTENANCE > OFFLINE > sensor state", () => {
    expect(displayStatus(m("a", "ACTIVE", { online: false, maintenance: true }))).toBe("MAINTENANCE")
    expect(displayStatus(m("a", "ACTIVE", { online: false }))).toBe("OFFLINE")
    expect(displayStatus(m("a", "RESTING"))).toBe("RESTING")
  })

  it("only counts in-service, reporting machines", () => {
    expect(countsForLiveStats(m("a", "ACTIVE"))).toBe(true)
    expect(countsForLiveStats(m("a", "ACTIVE", { online: false }))).toBe(false)
    expect(countsForLiveStats(m("a", "AVAILABLE", { maintenance: true }))).toBe(false)
  })

  it("leaves offline machines out of the numerator and the denominator", () => {
    const base = [m("a", "ACTIVE"), m("b", "AVAILABLE"), m("c", "AVAILABLE"), m("d", "RESTING", { maintenance: true })]
    const before = liveCounts(base)
    // taking a busy node offline removes it from both sides…
    const after = liveCounts([...base, m("e", "ACTIVE", { online: false })])
    expect(after.utilisation).toBe(before.utilisation)
    expect(after).toMatchObject({ total: 5, operational: 4, reporting: 3, offline: 1, maintenance: 1, available: 2, inUse: 1 })
    // …and so does a free one
    expect(liveCounts([...base, m("e", "AVAILABLE", { online: false })]).available).toBe(2)
  })

  it('summarises as "N of T reporting · M in maintenance · K offline"', () => {
    const s = computeSummary([m("a", "ACTIVE"), m("b", "AVAILABLE", { online: false }), m("c", "AVAILABLE", { maintenance: true })], [])
    expect(s).toMatchObject({ reporting: 1, offline: 1, maintenance: 1, utilisation: 1 })
    expect(reportingLine(s)).toBe("1 of 3 reporting · 1 in maintenance · 1 offline")
    expect(reportingLine({ total: 3, reporting: 3, maintenance: 0, offline: 0 })).toBe("3 of 3 reporting")
  })
})

describe("history eligibility", () => {
  const now = d(2026, 11, 23, 20).getTime()
  const excl = historyExclusions(
    "BC01",
    [{ since: d(2026, 11, 20, 9).toISOString(), end: d(2026, 11, 20, 11).toISOString(), reason: "x", expectedBack: null }],
    [{ since: d(2026, 11, 23, 17).toISOString(), end: null }],
    now,
  )

  it("turns maintenance and offline records into exclusion windows", () => {
    expect(excl.map((w) => w.reason)).toEqual(["maintenance", "offline"])
    expect(excl[1].end).toBe(now)
    expect(countsForHistory({ id: "BC01" }, d(2026, 11, 23, 18).getTime(), excl)).toBe(false)
    expect(countsForHistory({ id: "BC01" }, d(2026, 11, 23, 16).getTime(), excl)).toBe(true)
    expect(countsForHistory({ id: "PC01" }, d(2026, 11, 23, 18).getTime(), excl)).toBe(true)
  })

  it("leaves offline time out of utilisation instead of counting it as 0 % or 100 %", () => {
    // in use 5–7 pm; the node went offline at 5 pm still showing ACTIVE
    const events = [ev("BC01", "AVAILABLE", d(2026, 11, 23, 6)), ev("BC01", "ACTIVE", d(2026, 11, 23, 15)), ev("BC01", "RESTING", d(2026, 11, 23, 16))]
    const from = d(2026, 11, 23, 0).getTime()
    const offline = excl.filter((w) => w.reason === "offline")
    // 7 am – 5 pm counts (10 h), 1 h of it in use (3–4 pm ACTIVE) + 1 h RESTING (4–5 pm)
    const u = utilisationBetween(inUseIntervals(events, "BC01", from, now, offline), offline, from, now)
    expect(u).toBeCloseTo(2 / 10)
  })

  it("taking BC01 offline only removes BC01 from gym-wide utilisation", () => {
    const at = d(2026, 11, 23, 19)
    const events = [
      ev("BC01", "AVAILABLE", d(2026, 11, 23, 6)),
      ev("PC01", "AVAILABLE", d(2026, 11, 23, 6)),
      ...session("PC01", d(2026, 11, 23, 9), 60, 60),
      ...session("BC01", d(2026, 11, 23, 13), 30, 30),
      ev("BC01", "ACTIVE", d(2026, 11, 23, 17)), // still "ACTIVE" when the node went quiet
    ]
    const machines = [
      { id: "PC01", group: "back-biceps" },
      { id: "BC01", group: "back-biceps" },
    ]
    const off = historyExclusions("BC01", [], [{ since: d(2026, 11, 23, 17).toISOString(), end: null }], at.getTime())

    const gym = computeHeatmap(events, { machineId: "ALL", machineIds: ["PC01", "BC01"], now: at, weeks: 1, downtime: off })
    const pcOnly = computeHeatmap(events, { machineId: "ALL", machineIds: ["PC01"], now: at, weeks: 1 })
    const bcBefore = computeHeatmap(events, { machineId: "BC01", machineIds: ["BC01"], now: at, weeks: 1, downtime: off })
    const mon = 0
    // 5–7 pm: BC01 is offline the whole block, so the gym figure is PC01's alone
    expect(gym.values[mon][5]).toBe(pcOnly.values[mon][5])
    // earlier blocks still include BC01
    expect(bcBefore.values[mon][3]).toBe(0.5)
    expect(gym.values[mon][3]).toBeCloseTo((pcOnly.values[mon][3] + bcBefore.values[mon][3]) / 2, 3)

    // same for utilisation, rank and group averages
    const fleet = fleetUtilisation(events, machines, at, off)
    const solo = fleetUtilisation(
      events.filter((e) => e.machineId === "PC01"),
      machines.slice(0, 1),
      at,
    )
    expect(fleet.rates.get("PC01")).toEqual(solo.rates.get("PC01"))
    // BC01's offline evening counts neither as busy nor as idle: 1 h in use of 10 h counted
    expect(fleet.rates.get("BC01")!.today).toBeCloseTo(1 / 10)
  })

  it("busiest block today ignores time machines spent offline", () => {
    const now = d(2026, 11, 23, 12)
    const events = [ev("A", "AVAILABLE", d(2026, 11, 23, 6)), ev("B", "ACTIVE", d(2026, 11, 23, 9))]
    // B went offline at 9 am showing ACTIVE: without exclusions 9–11 looks 50 % busy
    expect(busiestBlockToday(events, ["A", "B"], now)?.value).toBe(0.5)
    const off = currentExclusions([m("A", "AVAILABLE"), m("B", "ACTIVE", { online: false, lastHeartbeat: d(2026, 11, 23, 9).toISOString() })], now.getTime())
    expect(busiestBlockToday(events, ["A", "B"], now, off)).toBeNull()
  })
})

describe("offline nodes in the mock", () => {
  const START = new Date(2026, 10, 17, 18, 0).getTime() // Tuesday 6 pm

  it("drops an offline node from the summary and re-syncs it from its next packet", async () => {
    let now = START
    const ds = new MockDataSource({ now: () => now, live: false })
    function step(ms: number) {
      now += ms
      ds.tick()
    }
    const before = await ds.getSummary()
    ds.demo.startSession("BC01")
    ds.demo.setOnline("BC01", false)
    const during = await ds.getSummary()
    expect(during.reporting).toBe(before.reporting - 1)
    expect(during.offline).toBe(before.offline + 1)
    expect((await ds.getMachine("BC01")).state).toBe("ACTIVE") // last known
    const eventsBefore = (await ds.getEvents("BC01", new Date(START), new Date(now + 1))).length

    // 40 min unheard: the session ends on the node, but nothing is recorded
    for (let i = 0; i < 40; i++) step(60_000)
    expect((await ds.getEvents("BC01", new Date(START), new Date(now))).length).toBe(eventsBefore)
    const stats = await ds.getMachineStats("BC01")
    expect(stats.offlineHistory[0]).toMatchObject({ end: null })

    ds.demo.setOnline("BC01", true)
    const back = await ds.getMachine("BC01")
    expect(back.online).toBe(true)
    expect(back.state).toBe("AVAILABLE") // re-synced from the nodes packet
    expect((await ds.getMachineStats("BC01")).offlineHistory[0].end).not.toBeNull()
    expect((await ds.getSummary()).reporting).toBe(before.reporting)
  })
})
