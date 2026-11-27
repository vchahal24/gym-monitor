// PLANNER KIND TESTS
// Purpose: kind availability, the kind picker and unit suggestions

import { describe, expect, it } from "vitest"
import { MockDataSource } from "../../data/mock/MockDataSource"
import type { Machine, MachineKind, MachineState } from "../../types"
import { historyExclusions } from "../eligibility"
import { computeKindAvailability } from "../kindAvailability"
import { d, ev, session } from "../testUtils"
import {
  buildPlannerKinds,
  liveUnitSets,
  generatePlans,
  kindLive,
  kindPickerLabel,
  resolveKinds,
  suggestUnit,
  suggestUnits,
  todayOutlook,
  type plannerData,
  type plannerKind,
  type plannerUnit,
} from "."

function grid(v: number | ((day: number, block: number) => number)) {
  return Array.from({ length: 7 }, (_, day) => Array.from({ length: 7 }, (_, b) => (typeof v === "number" ? v : v(day, b))))
}

// Monday 23 Nov 2026; block 1 = 9–11 am
const MON = 0
const B9 = 1

describe("computeKindAvailability (pAnyFree / typicalFree from history)", () => {
  const now = d(2026, 11, 23, 12)
  function open(id: string) {
    return ev(id, "AVAILABLE", d(2026, 11, 23, 6))
  }

  it("non-overlapping sessions: one unit is always free", () => {
    // A busy 9–10, B busy 10–11: never both at once
    const events = [open("A"), open("B"), ...session("A", d(2026, 11, 23, 9), 55, 5), ...session("B", d(2026, 11, 23, 10), 55, 5)]
    const [k] = computeKindAvailability(events, [{ kind: "treadmill", units: ["A", "B"] }], now, 1)
    expect(k.pAnyFree[MON][B9]).toBe(1)
    expect(k.typicalFree[MON][B9]).toBe(1) // one of two free on average
  })

  it("overlapping sessions: both busy at once counts against pAnyFree", () => {
    // A busy 9–11, B busy 10–11: none free for the second hour
    const events = [open("A"), open("B"), ...session("A", d(2026, 11, 23, 9), 115, 5), ...session("B", d(2026, 11, 23, 10), 55, 5)]
    const [k] = computeKindAvailability(events, [{ kind: "treadmill", units: ["A", "B"] }], now, 1)
    expect(k.pAnyFree[MON][B9]).toBe(0.5)
    expect(k.typicalFree[MON][B9]).toBe(0.5) // 1 free for an hour, 0 for an hour
    // multiplying per unit odds would say 1 − (1 × 0.5) = 0.5 here too, but…
  })

  it("…differs from multiplying per-unit odds when units fill up together", () => {
    // both busy 9–10 at the same time, both free 10–11.
    const events = [open("A"), open("B"), ...session("A", d(2026, 11, 23, 9), 55, 5), ...session("B", d(2026, 11, 23, 9), 55, 5)]
    const [k] = computeKindAvailability(events, [{ kind: "treadmill", units: ["A", "B"] }], now, 1)
    // independent odds would claim 1 − 0.5 × 0.5 = 75 %; really its 50 %
    expect(k.pAnyFree[MON][B9]).toBe(0.5)
  })

  it("leaves maintenance and offline minutes out", () => {
    // A is busy 9–11; B is free but offline 9–10, then in maintenance 10–11.
    const events = [open("A"), open("B"), ...session("A", d(2026, 11, 23, 9), 115, 5)]
    const excl = historyExclusions(
      "B",
      [{ since: d(2026, 11, 23, 10).toISOString(), end: d(2026, 11, 23, 11).toISOString(), reason: "x", expectedBack: null }],
      [{ since: d(2026, 11, 23, 9).toISOString(), end: d(2026, 11, 23, 10).toISOString() }],
      now.getTime(),
    )
    const [k] = computeKindAvailability(events, [{ kind: "treadmill", units: ["A", "B"] }], now, 1, excl)
    // only A counts in 9–11 and it was busy: nothing free (B's idle time is not "free")
    expect(k.pAnyFree[MON][B9]).toBe(0)
    const [noExcl] = computeKindAvailability(events, [{ kind: "treadmill", units: ["A", "B"] }], now, 1)
    expect(noExcl.pAnyFree[MON][B9]).toBe(1)
  })
})

// ---------------- PLANNER KINDS ----------------

function m(id: string, kind: MachineKind, state: MachineState = "AVAILABLE", opts: { online?: boolean; maintenance?: boolean } = {}): Machine {
  return {
    id,
    name: id,
    zoneId: "cardio",
    group: "cardio",
    kind,
    state,
    since: "",
    sessionStartedAt: null,
    override: null,
    online: opts.online ?? true,
    lastHeartbeat: null,
    maintenance: opts.maintenance ? { since: "", reason: "x", expectedBack: null } : null,
  }
}

const LAYOUT = [
  { id: "TM01", name: "Treadmill 1", label: "", group: "cardio" as const, kind: "treadmill" as const, x: 0, y: 0 },
  { id: "TM02", name: "Treadmill 2", label: "", group: "cardio" as const, kind: "treadmill" as const, x: 100, y: 0 },
  { id: "TM03", name: "Treadmill 3", label: "", group: "cardio" as const, kind: "treadmill" as const, x: 200, y: 0 },
  { id: "RW01", name: "Rower", label: "", group: "cardio" as const, kind: "rower" as const, x: 210, y: 0 },
  { id: "BK01", name: "Bike", label: "", group: "cardio" as const, kind: "bike" as const, x: 300, y: 0 },
]

function kinds(machines: Machine[], occ: Record<string, number> = {}) {
  return buildPlannerKinds({
    live: liveUnitSets(machines),
    layout: LAYOUT,
    availability: [{ kind: "treadmill", units: [], pAnyFree: grid(0.9), typicalFree: grid(2) }],
    unitOccupancy: new Map(Object.entries(occ).map(([id, v]) => [id, grid(v)])),
    avgWorkout: new Map(),
  })
}

const SLOT = { day: MON, block: B9, blocks: 1 }

describe("kind picker", () => {
  it("lists one entry per kind with a count and units in service", () => {
    const ks = kinds([
      m("TM01", "treadmill", "AVAILABLE", { maintenance: true }),
      m("TM02", "treadmill"),
      m("TM03", "treadmill"),
      m("RW01", "rower"),
      m("BK01", "bike"),
    ])
    expect(ks.map((k) => k.id)).toEqual(["treadmill", "rower", "bike"])
    expect(kindPickerLabel(ks[0])).toEqual({ label: "Treadmill ×3", detail: "2 in service", disabled: false })
    expect(kindPickerLabel(ks[1])).toEqual({ label: "Rowing machine ×1", detail: null, disabled: false })
  })

  it("disables a kind when every unit is in maintenance or offline", () => {
    const ks = kinds([
      m("TM01", "treadmill"),
      m("TM02", "treadmill"),
      m("TM03", "treadmill"),
      m("RW01", "rower", "AVAILABLE", { online: false }),
      m("BK01", "bike", "AVAILABLE", { maintenance: true }),
    ])
    const rower = ks.find((k) => k.id === "rower")!
    expect(rower.operational).toBe(false)
    expect(kindPickerLabel(rower)).toMatchObject({ detail: "Out of service", disabled: true })
    // a plan or preset that asks for it gets a same group kind instead
    expect(resolveKinds(["rower"], ks).substitutions).toEqual([{ originalId: "rower", substituteId: "treadmill" }])
  })
})

describe("suggested unit", () => {
  const all = [m("TM01", "treadmill"), m("TM02", "treadmill"), m("TM03", "treadmill"), m("RW01", "rower"), m("BK01", "bike")]

  it("is the unit with the lowest occupancy in that block", () => {
    const [tm] = kinds(all, { TM01: 0.6, TM02: 0.2, TM03: 0.4 })
    expect(suggestUnit(tm, SLOT)).toMatchObject({ unitId: "TM02", occupancy: 0.2 })
  })

  it("never offers units in maintenance or offline", () => {
    const [tm] = kinds(
      [
        m("TM01", "treadmill"),
        m("TM02", "treadmill", "AVAILABLE", { maintenance: true }),
        m("TM03", "treadmill", "AVAILABLE", { online: false }),
        m("RW01", "rower"),
        m("BK01", "bike"),
      ],
      {
        TM01: 0.6,
        TM02: 0.1,
        TM03: 0.1,
      },
    )
    expect(suggestUnit(tm, SLOT).unitId).toBe("TM01")
  })

  it("breaks ties by distance to the rest of the workout on the floor plan", () => {
    const ks = kinds(all, { TM01: 0.3, TM02: 0.3, TM03: 0.3 })
    const tm = ks[0]
    const rower = ks.find((k) => k.id === "rower")!
    // the rower is at x = 210, right next to TM03.
    expect(suggestUnit(tm, SLOT, [tm, rower]).unitId).toBe("TM03")
    expect(suggestUnits([tm, rower], SLOT).map((s) => s.unitId)).toEqual(["TM03", "RW01"])
  })

  it("swaps a suggestion that is busy right now for a free unit", () => {
    const [tm] = kinds([m("TM01", "treadmill"), m("TM02", "treadmill", "ACTIVE"), m("TM03", "treadmill"), m("RW01", "rower"), m("BK01", "bike")], {
      TM01: 0.5,
      TM02: 0.1,
      TM03: 0.3,
    })
    expect(suggestUnit(tm, SLOT).unitId).toBe("TM02")
    expect(suggestUnit(tm, SLOT, [], true)).toMatchObject({ unitId: "TM03", swappedLive: true })
    expect(kindLive(tm).free.map((u: plannerUnit) => u.id)).toEqual(["TM01", "TM03"])
  })
})

describe("regression: TM01 breaks → the planner never suggests TM01", () => {
  it("drops TM01 from every suggestion and plan as soon as it is in maintenance", async () => {
    const now = d(2026, 11, 23, 16) // Monday 4 pm
    const ds = new MockDataSource({ now: () => now.getTime(), live: false })
    async function build(old?: plannerData & { availability: Awaited<ReturnType<typeof ds.getKindAvailability>> }) {
      const machines = await ds.getMachines()
      const [fresh, heatmaps, stats, gym] = await Promise.all([
        ds.getKindAvailability(4),
        Promise.all(machines.map((x) => ds.getHeatmap(x.id, 4))),
        Promise.all(machines.map((x) => ds.getMachineStats(x.id))),
        ds.getHeatmap("ALL", 4),
      ])
      // `old`: keep the history from before (as the hook does until its refetch lands), live machines now
      const availability = old?.availability ?? fresh
      const data = {
        availability,
        gymOccupancy: gym.values,
        kinds: buildPlannerKinds({
          live: liveUnitSets(machines),
          availability,
          unitOccupancy: new Map(heatmaps.map((h, i) => [machines[i].id, h.values])),
          avgWorkout: new Map(stats.map((s) => [s.machineId, s.avgWorkoutSeconds])),
        }),
      }
      return data
    }
    function mentions(data: plannerData, id: string) {
      const tm = data.kinds.find((k) => k.id === "treadmill")!
      const picks: plannerKind[] = [tm, data.kinds.find((k) => k.id === "rower")!]
      const outlook = todayOutlook(picks, data, now)
      const slots = [...outlook.today, ...outlook.laterDays, ...outlook.tomorrow]
      const suggested = slots.flatMap((s) => [...suggestUnits(picks, s), ...suggestUnits(picks, s, true)]).map((s) => s.unitId)
      const plans = generatePlans(
        { workouts: [{ name: "Cardio", kinds: ["treadmill", "rower"] }], availability: grid(1).map((r) => r.map(Boolean)), minRestDays: 1, sameTime: false },
        data,
      )
      const planned = plans.plans.flatMap((p) => p.workouts.flatMap((w) => w.units.map((u) => u.unitId)))
      const live = kindLive(tm).inService.map((u) => u.id)
      return [...suggested, ...planned, ...live].includes(id)
    }

    const before = await build()
    expect(
      before.kinds
        .find((k) => k.id === "treadmill")!
        .units.filter((u) => u.available)
        .map((u) => u.id),
    ).toContain("TM01")

    ds.demo.setMaintenance("TM01", "Belt snapped (demo)")
    const after = await build()
    const tm = after.kinds.find((k) => k.id === "treadmill")!
    expect(tm.units.find((u) => u.id === "TM01")!.available).toBe(false)
    expect(kindPickerLabel(tm)).toMatchObject({ label: "Treadmill ×4", detail: "2 in service" }) // TM03 is seeded in maintenance too
    expect((await ds.getKindAvailability(4)).find((k) => k.kind === "treadmill")!.units).not.toContain("TM01")
    expect(mentions(after, "TM01")).toBe(false)

    // even with stale history (before a refetch lands), live unit flags keep TM01 out
    const stale = await build(before)
    expect(stale.availability.find((k) => k.kind === "treadmill")!.units).toContain("TM01")
    expect(mentions(stale, "TM01")).toBe(false)
  })
})
