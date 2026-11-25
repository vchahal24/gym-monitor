// ADMIN VIEW TESTS
// Purpose: the owner dashboard view on the mock gym

import { describe, expect, it } from "vitest"
import { MockDataSource } from "../data/mock/MockDataSource"
import { computeAdminView } from "./adminView"

describe("computeAdminView on the mock gym", () => {
  it("produces popularity, saturation and data-driven recommendations", async () => {
    const at = new Date(2026, 10, 20, 12).getTime() // Friday noon
    const ds = new MockDataSource({ now: () => at, live: false })
    const machines = await ds.getMachines()
    const [stats, events, heatmap] = await Promise.all([
      Promise.all(machines.map((m) => ds.getMachineStats(m.id))),
      ds.getEvents("ALL", new Date(at - 29 * 86_400_000), new Date(at)),
      ds.getHeatmap("ALL", 4),
    ])
    const t0 = performance.now()
    const v = computeAdminView({ stats, events, heatmap, machines, at })
    const ms = performance.now() - t0
    console.log(`computeAdminView: ${ms.toFixed(0)} ms`)
    console.log(v.recs.map((r) => `${r.type}: ${r.title} — ${r.detail}`).join("\n"))
    console.log(
      v.kinds.map((k) => `${k.kind} x${k.units.length}: ${(k.utilisation * 100).toFixed(0)}% avg, ${(k.weekdayEvening * 100).toFixed(0)}% all busy`).join(", "),
    )
    console.log(v.groups.map((g) => `${g.group}: ${(g.weekdayEvening * 100).toFixed(0)}%`).join(", "))
    console.log(JSON.stringify(v.rests), JSON.stringify(v.trend.map((t) => t.utilisation.toFixed(2))))

    expect(v.rows).toHaveLength(34)
    expect(v.rows[0].utilisation).toBeGreaterThan(v.rows.at(-1)!.utilisation)
    expect(v.recs.some((r) => r.type === "buy" && /chest press|lat pulldown/.test(r.title))).toBe(true)
    expect(v.recs.some((r) => r.type === "replace" && r.machineIds.includes("HAD01"))).toBe(true)
    expect(v.trend).toHaveLength(4)
    // by kind: one row per kind, units add up to every machine
    const tm = v.kinds.find((k) => k.kind === "treadmill")!
    expect(tm.units).toEqual(["TM01", "TM02", "TM03", "TM04"])
    expect(v.kinds.reduce((n, k) => n + k.units.length, 0)).toBe(34)
    expect(tm.weekdayEvening).toBeLessThanOrEqual(1)
    // every buy recommendation rests on its kinds saturation
    for (const r of v.recs.filter((x) => x.type === "buy")) {
      const k = v.kinds.find((x) => x.units.join() === r.machineIds.join())!
      expect(r.value).toBe(k.weekdayEvening)
    }
    expect(ms).toBeLessThan(3000)
  })
})
