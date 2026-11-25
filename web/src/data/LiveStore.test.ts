// LIVE STORE TESTS
// Purpose: the live store keeps the right events and batches its updates

import { describe, expect, it } from "vitest"
import { startOfDay } from "../lib/time"
import { LiveStore, windowStart } from "./LiveStore"
import { MockDataSource } from "./mock/MockDataSource"

describe("LiveStore", () => {
  it("keeps all of today, even on a busy day with more than 5000 events", async () => {
    // Monday 7 pm, then three more live hours
    let now = new Date(2026, 10, 23, 19, 0).getTime()
    const ds = new MockDataSource({ now: () => now, live: false })
    const store = new LiveStore(ds, () => now)
    store.start()
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 3 * 3600; i++) {
      now += 1000
      ds.tick()
    }
    const snap = store.getSnapshot()
    // everything since 6 pm yesterday, the old store capped this at 5000
    const truth = await ds.getEvents("ALL", new Date(windowStart(now)), new Date(now))
    expect(truth.length).toBeGreaterThan(5000)
    expect(snap.recentEvents.length).toBe(truth.length)
    const midnight = startOfDay(new Date(now)).getTime()
    expect(snap.recentEvents.filter((e) => Date.parse(e.timestamp) >= midnight).length).toBeGreaterThan(4000)
    store.stop()
    ds.dispose()
  })

  it("window starts 6 h before local midnight", () => {
    const t = new Date(2026, 10, 23, 10, 0).getTime()
    expect(windowStart(t)).toBe(new Date(2026, 10, 22, 18, 0).getTime())
  })
})
