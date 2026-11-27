// REAL SENSOR LOGIC TESTS
// Purpose: real node exclusions, no-data heatmap cells, per machine timing, the planner and admin "collecting data"

import { describe, expect, it } from "vitest"
import { GYM_LAYOUT } from "../config/gym-layout"
import { FALLBACK_MOTION_CONFIG } from "../config/real-sensors"
import { RESTING_TIMEOUT_SECONDS } from "../config/state-machine"
import type { MachineStats } from "../types"
import { popularity } from "./admin"
import { computeHeatmap } from "./heatmap"
import { kindPickerLabel, machineOrder, slotScore, type plannerKind } from "./planner"
import { eventsInRange, mergeEvents, realExclusions, realMachine, recordingFor } from "./realSensors"
import { restingCountdownSeconds } from "./remaining"
import { d, ev } from "./testUtils"
import { countdownStartSeconds, isRealSensor, nowFor, restingTimeoutSecondsFor } from "./timing"
import { utilisationRates } from "./utilisation"

const LE01 = GYM_LAYOUT.find((l) => l.id === "LE01")!
const NOW = d(2026, 11, 25, 18, 0) // Wednesday 6 pm

describe("realExclusions", () => {
  const base = {
    machineId: "LE01",
    spans: [],
    recordingSince: d(2026, 11, 25, 9, 0).toISOString(),
    bridgeDownSince: null,
    maintenance: [],
    from: d(2026, 10, 28).getTime(),
    realNow: NOW.getTime(),
    dataNow: NOW.getTime(),
  }

  it("leaves out everything before recording started", () => {
    expect(realExclusions(base)).toEqual([{ machineId: "LE01", start: base.from, end: d(2026, 11, 25, 9).getTime(), reason: "offline" }])
  })

  it("adds offline spans (open ones up to now), a dead bridge and the sim time past real time", () => {
    const w = realExclusions({
      ...base,
      spans: [
        { since: d(2026, 11, 25, 12).toISOString(), end: d(2026, 11, 25, 12, 30).toISOString(), reason: "offline" },
        { since: d(2026, 11, 25, 17, 30).toISOString(), end: null, reason: "sensor_error" },
      ],
      bridgeDownSince: d(2026, 11, 25, 17, 50).getTime(),
      dataNow: NOW.getTime() + 3_600_000,
      maintenance: [{ since: d(2026, 11, 25, 10).toISOString(), end: d(2026, 11, 25, 11).toISOString(), reason: "x", expectedBack: null }],
    })
    expect(w.map((x) => [new Date(x.start).getHours() + new Date(x.start).getMinutes() / 60, x.reason])).toEqual([
      [0, "offline"],
      [12, "offline"],
      [17.5, "offline"],
      [17 + 50 / 60, "offline"],
      [18, "offline"],
      [10, "maintenance"],
    ])
    expect(w[2].end).toBe(NOW.getTime())
    expect(w[4].end).toBe(NOW.getTime() + 3_600_000)
  })

  it("never reached = all history is excluded", () => {
    expect(realExclusions({ ...base, recordingSince: null })).toEqual([{ machineId: "LE01", start: base.from, end: NOW.getTime(), reason: "offline" }])
  })
})

describe("no-data heatmap cells", () => {
  it("cells with no recorded time have coverage 0, recorded ones are real percentages", () => {
    const events = [ev("LE01", "AVAILABLE", d(2026, 11, 25, 9)), ev("LE01", "ACTIVE", d(2026, 11, 25, 9, 30)), ev("LE01", "AVAILABLE", d(2026, 11, 25, 10, 30))]
    const from = d(2026, 10, 29).getTime()
    const downtime = realExclusions({
      machineId: "LE01",
      spans: [],
      recordingSince: d(2026, 11, 25, 9).toISOString(),
      bridgeDownSince: null,
      maintenance: [],
      from,
      realNow: NOW.getTime(),
      dataNow: NOW.getTime(),
    })
    const h = computeHeatmap(events, { machineId: "LE01", machineIds: ["LE01"], now: NOW, weeks: 4, downtime, withCoverage: true })
    // Wednesday (day 2): 7-9 am never recorded, 9-11 am recorded on 1 of the 4 Wednesdays and half of that in use
    // the percentage is over recorded time only, so the 3 unrecorded Wednesdays dont drag it to 12.5 %
    expect(h.coverage![2][0]).toBe(0)
    expect(h.coverage![2][1]).toBe(0.25)
    expect(h.values[2][1]).toBe(0.5)
    // any other day has no data at all
    expect(h.coverage![0].every((c) => c === 0)).toBe(true)
    expect(h.values[0].every((v) => v === 0)).toBe(true)
  })

  it("coverage is only added when asked for", () => {
    const h = computeHeatmap([], { machineId: "X", machineIds: ["X"], now: NOW, weeks: 1 })
    expect(h.coverage).toBeUndefined()
  })
})

describe("per machine timing", () => {
  const real = realMachine(LE01, null, { bridgeConnected: true, coordinatorConnected: true, config: FALLBACK_MOTION_CONFIG, fallbackSince: NOW.toISOString() })

  it("simulated machines keep state-machine.ts and the data clock", () => {
    const sim = { timing: undefined }
    expect(isRealSensor(sim)).toBe(false)
    expect(restingTimeoutSecondsFor(sim)).toBe(RESTING_TIMEOUT_SECONDS)
    expect(countdownStartSeconds(sim)).toBe(RESTING_TIMEOUT_SECONDS)
    expect(nowFor(sim, NOW, 0)).toBe(NOW)
  })

  it("real nodes use the firmware timing (AVAILABLE from the last movement) and real time", () => {
    expect(isRealSensor(real)).toBe(true)
    expect(restingTimeoutSecondsFor(real)).toBe(3)
    expect(countdownStartSeconds(real)).toBeCloseTo(2.6)
    expect(nowFor(real, NOW, 123).getTime()).toBe(123)
    const fiveMin = { ...real, timing: { restingTimeoutSeconds: 300, restingDelaySeconds: 0.4, source: "motion.h" as const } }
    const resting = { ...fiveMin, state: "RESTING" as const, since: new Date(Date.now() - 10_000).toISOString() }
    expect(restingCountdownSeconds(resting, new Date(0))).toBe(290)
  })

  it("a node the bridge never heard from is waiting and offline", () => {
    expect(real.online).toBe(false)
    expect(real.sensor?.waiting).toBe(true)
    expect(real.prototype).toBe(true)
  })
})

describe("real event lists", () => {
  it("merges live events after the recorded ones without repeats", () => {
    const base = [ev("LE01", "AVAILABLE", d(2026, 11, 25, 9)), ev("LE01", "ACTIVE", d(2026, 11, 25, 10))]
    const merged = mergeEvents(base, [base[1], ev("LE01", "ACTIVE", d(2026, 11, 25, 10, 1)), ev("LE01", "RESTING", d(2026, 11, 25, 10, 2))])
    expect(merged.map((e) => e.state)).toEqual(["AVAILABLE", "ACTIVE", "RESTING"])
    expect(eventsInRange(merged, d(2026, 11, 25, 9, 30).getTime(), d(2026, 11, 25, 11).getTime(), true).map((e) => e.state)).toEqual([
      "AVAILABLE",
      "ACTIVE",
      "RESTING",
    ])
  })

  it("real ACTIVE→AVAILABLE still counts as occupied time up to AVAILABLE", () => {
    const events = [ev("LE01", "AVAILABLE", d(2026, 11, 25, 9)), ev("LE01", "ACTIVE", d(2026, 11, 25, 10)), ev("LE01", "AVAILABLE", d(2026, 11, 25, 10, 42))]
    expect(utilisationRates(events, "LE01", NOW).today).toBeGreaterThan(0)
  })

  it("recording hours against the threshold", () => {
    const rec = { startedAt: NOW.toISOString(), now: NOW.toISOString(), machines: [{ machineId: "LE01", hours: 30, firstEventAt: null }] }
    expect(recordingFor("LE01", rec, 24)).toEqual({ since: NOW.toISOString(), hours: 30, enough: true })
    expect(recordingFor("LP01", rec, 24).enough).toBe(false)
    expect(recordingFor("LE01", null, 24)).toEqual({ since: null, hours: 0, enough: false })
  })
})

describe("collecting data", () => {
  function grid(v: number) {
    return Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => v))
  }
  function kind(id: plannerKind["id"], p: number, collectingData = false): plannerKind {
    return { id, name: id, group: "legs", units: [], pFree: grid(p), typicalFree: grid(1), avgWorkoutSeconds: 0, operational: true, collectingData }
  }
  const gym = { gymOccupancy: grid(0.4) }

  it("planner kinds without enough real data dont move the score and are still pickable", () => {
    const withReal = slotScore([kind("leg-curl", 0.5), kind("leg-extension", 0.01, true)], gym, 0, 0)!
    const without = slotScore([kind("leg-curl", 0.5)], gym, 0, 0)!
    expect(withReal.score).toBeCloseTo(without.score)
    expect(withReal.perMachine.find((p) => p.id === "leg-extension")!.noData).toBe(true)
    expect(machineOrder(withReal)).toEqual(["leg-curl", "leg-extension"])
    const onlyReal = slotScore([kind("leg-extension", 0, true)], gym, 0, 0)!
    expect(onlyReal.mean).toBeCloseTo(0.6)
    const unit = { id: "LE01", name: "Leg Extension", occupancy: grid(0), x: 0, y: 0, available: true, freeNow: true }
    expect(kindPickerLabel({ ...kind("leg-extension", 0, true), units: [unit] })).toEqual({
      label: "leg-extension ×1",
      detail: "live sensor · not enough data yet",
      disabled: false,
    })
  })

  it("admin popularity marks real nodes still collecting and lists them last", () => {
    function stats(id: string, u: number, recording?: MachineStats["recording"]): MachineStats {
      return {
        machineId: id,
        utilisation: { today: u, week: u, fourWeeks: u },
        rank: 1,
        groupAvgUtilisation: u,
        avgWorkoutSeconds: 60,
        medianWorkoutSeconds: 60,
        estimatedRemainingSeconds: null,
        sessionsPerDay: [],
        recentSessions: [],
        maintenanceHistory: [],
        offlineHistory: [],
        ...(recording ? { recording } : {}),
      }
    }
    const info = (id: string) => ({ id, name: id, group: "legs" as const, kind: "leg-press" as const })
    const rows = popularity(
      [info("LP01"), info("LC01")],
      [stats("LP01", 0.9, { since: NOW.toISOString(), hours: 2, enough: false }), stats("LC01", 0.3)],
      NOW.getTime(),
    )
    expect(rows.map((r) => [r.id, r.collecting])).toEqual([
      ["LC01", false],
      ["LP01", true],
    ])
  })
})
