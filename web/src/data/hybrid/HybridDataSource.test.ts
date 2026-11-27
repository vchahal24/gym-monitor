// HYBRID DATA SOURCE TESTS
// Purpose: the real nodes come from a (fake) bridge, everything else from the mock, and neither leaks into the other

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GYM_LAYOUT } from "../../config/gym-layout"
import { isOpenAt } from "../../config/gym-hours"
import { offlineLabel } from "../../components/stateMeta"
import { restingCountdownSeconds } from "../../lib/remaining"
import { findViolation } from "../../lib/stateMachine"
import type { liveMessage } from "../../types"
import { LiveStore } from "../LiveStore"
import { MockDataSource } from "../mock/MockDataSource"
import { fakeBridge } from "./fakeBridge"
import { HybridDataSource } from "./HybridDataSource"

const WED_6PM = new Date(2026, 10, 25, 18, 0).getTime()
const REAL_IDS = ["LE01", "LP01"]

function setup({ start = WED_6PM, up = true } = {}) {
  let real = start
  let data = start
  const bridge = new fakeBridge({ realNow: () => real })
  bridge.up = up
  const ds = new HybridDataSource({
    apiURL: "http://bridge.test:8000",
    now: () => data,
    realNow: () => real,
    mock: { live: false },
    client: { fetchFn: bridge.fetch, openSocket: bridge.openSocket, retryFirstMs: 1000, retryMaxMs: 8000 },
    firstLoadWaitMs: 2000,
  })
  const messages: liveMessage[] = []
  ds.subscribe((m) => messages.push(m))
  return {
    ds,
    bridge,
    messages,
    realNow: () => real,
    dataNow: () => data,
    // real time and the data clock move together (1×)
    advance(ms: number) {
      real += ms
      data += ms
    },
    // the demo is sped up, the sim clock runs ahead of real time
    speedUp(ms: number) {
      data += ms
    },
  }
}

// lets the fake fetch / WebSocket promises run
async function settle() {
  await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("HybridDataSource merge", () => {
  it("takes LE01/LP01 from the bridge and the other machines from the mock, in layout order", async () => {
    const { ds } = setup()
    await settle()
    const machines = await ds.getMachines()
    expect(machines.map((m) => m.id)).toEqual(GYM_LAYOUT.map((l) => l.id))
    for (const m of machines) {
      if (REAL_IDS.includes(m.id)) {
        expect(m.sensor?.xbeeAddress).toMatch(/^0013A200/)
        expect(m.timing?.restingTimeoutSeconds).toBe(3)
        expect(m.online).toBe(true)
      } else {
        expect(m.sensor).toBeUndefined()
        expect(m.timing).toBeUndefined()
      }
    }
    // the simulated ones are exactly what mock mode would show
    const plain = await new MockDataSource({ now: () => WED_6PM, live: false }).getMachines()
    const sims = machines.filter((m) => !REAL_IDS.includes(m.id))
    expect(sims).toEqual(plain.filter((m) => !REAL_IDS.includes(m.id)))
    ds.dispose()
  })

  it("real history is the recorded events only, simulated history has no LE01/LP01", async () => {
    const { ds, bridge, advance, realNow } = setup()
    await settle()
    advance(10_000)
    bridge.state("LE01", "ACTIVE")
    advance(2_000)
    bridge.state("LE01", "RESTING")
    const from = new Date(realNow() - 29 * 86_400_000)
    const to = new Date(realNow())
    const real = await ds.getEvents("LE01", from, to)
    expect(real).toEqual(bridge.events.get("LE01"))
    const all = await ds.getEvents("ALL", from, to)
    const plain = await new MockDataSource({ now: () => WED_6PM, live: false }).getEvents("ALL", from, new Date(WED_6PM))
    // the simulated part of ALL matches the mock without its LE01/LP01
    expect(all.filter((e) => !REAL_IDS.includes(e.machineId))).toEqual(plain.filter((e) => !REAL_IDS.includes(e.machineId)))
    expect(all.filter((e) => e.machineId === "LE01")).toEqual(real)
    expect(all.filter((e) => e.machineId === "LP01")).toEqual(bridge.events.get("LP01"))
    ds.dispose()
  })

  it("a real event changes nothing simulated, a simulated rush changes nothing real", async () => {
    const { ds, bridge, messages, advance } = setup()
    await settle()
    // the mocks heartbeat time follows the clock, everything else must stay put
    const simulated = async () => (await ds.getMachines()).filter((m) => !REAL_IDS.includes(m.id)).map((m) => ({ ...m, lastHeartbeat: null }))
    const before = await simulated()
    messages.length = 0
    advance(1000)
    bridge.state("LP01", "ACTIVE")
    expect(messages.every((m) => (m.type === "state" ? m.event.machineId : m.type === "online" ? m.machineId : m.machine.id) === "LP01")).toBe(true)
    expect(await simulated()).toEqual(before)
    messages.length = 0
    const started = ds.demo.rush()
    expect(started).toBeGreaterThan(0)
    const ids = new Set(messages.map((m) => (m.type === "state" ? m.event.machineId : m.type === "online" ? m.machineId : m.machine.id)))
    for (const id of REAL_IDS) expect(ids.has(id)).toBe(false)
    expect((await ds.getMachine("LP01")).state).toBe("ACTIVE")
    expect((await ds.getMachine("LE01")).state).toBe("AVAILABLE")
    ds.dispose()
  })

  it("live state packets reach the LiveStore as state events, with the sensor details", async () => {
    const { ds, bridge, advance, dataNow } = setup()
    const store = new LiveStore(ds, dataNow)
    store.start()
    await settle()
    advance(5000)
    bridge.state("LE01", "ACTIVE")
    bridge.push({ type: "heartbeat", machineId: "LE01", dynamicG: 0.412, lastHeartbeat: new Date(WED_6PM + 5000).toISOString(), revision: 2 })
    await settle()
    const snap = store.getSnapshot()
    const le = snap.machines.find((m) => m.id === "LE01")!
    expect(le.state).toBe("ACTIVE")
    expect(le.sensor?.dynamicG).toBe(0.412)
    expect(snap.recentEvents.at(-1)).toMatchObject({ machineId: "LE01", state: "ACTIVE" })
    store.stop()
    ds.dispose()
  })

  it("gym wide summary and heatmap cover all machines, real ones from real data", async () => {
    const { ds, bridge, advance } = setup()
    await settle()
    advance(1000)
    bridge.state("LE01", "ACTIVE")
    const summary = await ds.getSummary()
    expect(summary.total).toBe(GYM_LAYOUT.length)
    expect(summary.active).toBeGreaterThanOrEqual(1)
    const gym = await ds.getHeatmap("ALL")
    expect(gym.machineId).toBe("ALL")
    const stats = await ds.getMachineStats("LE01")
    expect(stats.recording).toEqual({ since: new Date(bridge.recordingStartedAt).toISOString(), hours: 1, enough: false })
    ds.dispose()
  })
})

describe("HybridDataSource bridge connection", () => {
  it("shows the real machines as not connected while the bridge is down, the rest keep working", async () => {
    const { ds, bridge, advance } = setup({ up: false })
    const loading = ds.getMachines()
    await vi.advanceTimersByTimeAsync(2000)
    const machines = await loading
    const le = machines.find((m) => m.id === "LE01")!
    expect(ds.bridge.getStatus()).toBe("bridge-offline")
    expect(le.online).toBe(false)
    expect(offlineLabel(le).label).toBe("Bridge not connected")
    expect(machines.filter((m) => !REAL_IDS.includes(m.id)).some((m) => m.online)).toBe(true)
    // no real data yet, so every LE01 block is "no data"
    const heat = await ds.getHeatmap("LE01")
    expect(heat.coverage!.flat().every((c) => c === 0)).toBe(true)

    // comes back: retries 1 s, 2 s, 4 s … so it reconnects on the next attempt
    bridge.start()
    advance(4000)
    await vi.advanceTimersByTimeAsync(8000)
    await settle()
    expect(ds.bridge.getStatus()).toBe("live")
    expect((await ds.getMachine("LE01")).online).toBe(true)
    ds.dispose()
  })

  it("goes offline when the bridge drops and recovers with backoff", async () => {
    const { ds, bridge } = setup()
    await settle()
    expect(ds.bridge.getStatus()).toBe("live")
    bridge.stop()
    await settle()
    expect(ds.bridge.getStatus()).toBe("bridge-offline")
    expect((await ds.getMachine("LP01")).sensor?.bridgeConnected).toBe(false)
    const tries = () => bridge.requests.filter((r) => r === "/api/config").length
    const first = tries()
    await vi.advanceTimersByTimeAsync(1000)
    expect(tries()).toBe(first + 1)
    await vi.advanceTimersByTimeAsync(1999)
    expect(tries()).toBe(first + 1) // the second wait is 2 s
    await vi.advanceTimersByTimeAsync(1)
    expect(tries()).toBe(first + 2)
    bridge.start()
    await vi.advanceTimersByTimeAsync(4000)
    await settle()
    expect(ds.bridge.getStatus()).toBe("live")
    expect((await ds.getMachine("LP01")).online).toBe(true)
    ds.dispose()
  })

  it("an unplugged coordinator and a sensor error both read as not reporting", async () => {
    const { ds, bridge } = setup()
    await settle()
    bridge.push({ type: "coordinator", connected: false, port: "/dev/ttyUSB0" })
    expect(ds.bridge.getStatus()).toBe("coordinator-unplugged")
    expect(offlineLabel(await ds.getMachine("LE01")).label).toBe("Coordinator unplugged")
    bridge.push({ type: "coordinator", connected: true, port: "/dev/ttyUSB0" })
    bridge.patch("LP01", { sensorError: true, status: "SENSOR_ERROR" })
    const lp = await ds.getMachine("LP01")
    expect(lp.online).toBe(false)
    expect(offlineLabel(lp).label).toBe("Sensor error")
    const summary = await ds.getSummary()
    expect(summary.reporting).toBe(summary.operational - summary.offline)
    expect(summary.offline).toBeGreaterThanOrEqual(1)
    bridge.patch("LP01", { sensorError: false, waiting: true })
    expect(offlineLabel(await ds.getMachine("LP01")).label).toBe("Waiting for sensor")
    ds.dispose()
  })
})

describe("HybridDataSource timing", () => {
  it("the real RESTING countdown follows /api/config and real time, not the sim clock", async () => {
    const { ds, bridge, advance, speedUp, dataNow, realNow } = setup()
    // the real nodes timers read the wall clock, so pin it to the tests real clock
    vi.spyOn(Date, "now").mockImplementation(realNow)
    await settle()
    bridge.state("LE01", "ACTIVE")
    advance(1000)
    bridge.state("LE01", "RESTING")
    advance(1000)
    // AVAILABLE 3 s after the last movement, RESTING came 0.4 s after it, so 2.6 s from RESTING, 1 s gone
    let le = await ds.getMachine("LE01")
    expect(restingCountdownSeconds(le, new Date(dataNow()))).toBe(2)
    // the demo at 240× moves the sim clock an hour ahead, the real countdown doesnt care
    speedUp(3_600_000)
    expect(restingCountdownSeconds(le, new Date(dataNow()))).toBe(2)
    // the firmware goes to 5 minutes: only /api/config changes
    bridge.config = { ...bridge.config, restingTimeoutSeconds: 300 }
    bridge.push({ type: "snapshot", machines: [...bridge.machines.values()], config: bridge.config, coordinator: { connected: true, port: "x" }, recording: bridge.recording() })
    le = await ds.getMachine("LE01")
    expect(le.timing?.restingTimeoutSeconds).toBe(300)
    expect(restingCountdownSeconds(le, new Date(dataNow()))).toBe(299)
    ds.dispose()
  })

  it("accepts ACTIVE→AVAILABLE and a 3 s rest for real nodes only", () => {
    const t = (s: number) => new Date(WED_6PM + s * 1000).toISOString()
    const events = [
      { state: "AVAILABLE" as const, timestamp: t(0) },
      { state: "ACTIVE" as const, timestamp: t(1) },
      { state: "RESTING" as const, timestamp: t(2) },
      { state: "AVAILABLE" as const, timestamp: t(4.6) },
      { state: "ACTIVE" as const, timestamp: t(10) },
      { state: "AVAILABLE" as const, timestamp: t(12) },
    ]
    expect(findViolation(events)).not.toBeNull()
    expect(findViolation(events, { realSensor: true })).toBeNull()
    expect(findViolation([events[0], events[0]], { realSensor: true })).toMatch(/repeats/)
  })
})

describe("HybridDataSource opening hours", () => {
  it("real activity shows while the gym is closed, the simulated machines stay idle", async () => {
    const night = new Date(2026, 10, 26, 1, 30).getTime() // Thursday 1:30 am
    expect(isOpenAt(night)).toBe(false)
    const { ds, bridge, advance, realNow } = setup({ start: night })
    const store = new LiveStore(ds, realNow)
    store.start()
    await settle()
    advance(1000)
    bridge.state("LE01", "ACTIVE")
    await settle()
    const machines = store.getSnapshot().machines
    expect(machines.find((m) => m.id === "LE01")!.state).toBe("ACTIVE")
    expect(machines.filter((m) => !REAL_IDS.includes(m.id) && m.state !== "AVAILABLE")).toEqual([])
    expect(store.getSnapshot().recentEvents.at(-1)).toMatchObject({ machineId: "LE01", state: "ACTIVE" })
    const summary = await ds.getSummary()
    expect(summary.active).toBe(1)
    store.stop()
    ds.dispose()
  })
})

describe("HybridDataSource demo and admin", () => {
  it("scenarios aimed at the real nodes do nothing to them", async () => {
    const { ds } = setup()
    await settle()
    expect(ds.demo.isRealSensor?.("LP01")).toBe(true)
    expect(ds.demo.isRealSensor?.("TM01")).toBe(false)
    ds.demo.startSession("LP01")
    ds.demo.leave("LP01")
    ds.demo.setOnline("LE01", false)
    ds.demo.quiet(60)
    const lp = await ds.getMachine("LP01")
    const le = await ds.getMachine("LE01")
    expect(lp.state).toBe("AVAILABLE")
    expect(le.online).toBe(true)
    // simulated ones still respond
    ds.demo.startSession("LPD01")
    expect((await ds.getMachine("LPD01")).state).toBe("ACTIVE")
    ds.dispose()
  })

  it("an admin hold pins a real machine while the bridge keeps recording, release goes back to the sensor", async () => {
    const { ds, bridge, advance, realNow } = setup()
    await settle()
    const { token } = await ds.adminLogin("admin", "gym4200")
    advance(1000)
    const held = await ds.setOverride("LE01", "RESTING", "hold", token)
    expect(held.override?.mode).toBe("hold")
    expect(held.state).toBe("RESTING")
    advance(1000)
    bridge.state("LE01", "ACTIVE")
    advance(1000)
    bridge.state("LE01", "RESTING")
    advance(1000)
    bridge.state("LE01", "AVAILABLE")
    expect((await ds.getMachine("LE01")).state).toBe("RESTING") // still held
    const recorded = await ds.getEvents("LE01", new Date(realNow() - 60_000), new Date(realNow()))
    expect(recorded.map((e) => e.state)).toEqual(["ACTIVE", "RESTING", "AVAILABLE"])
    expect((await ds.getOverrides(token))[0]).toMatchObject({ machineId: "LE01", to: "RESTING", mode: "hold" })
    advance(1000)
    const released = await ds.releaseOverride("LE01", token)
    expect(released.state).toBe("AVAILABLE")
    expect(released.override).toBeNull()
    await expect(ds.setOverride("LE01", "ACTIVE", "hold", "made-up")).rejects.toThrow()
    ds.dispose()
  })

  it("admin maintenance freezes a real machine in the frontend", async () => {
    const { ds, bridge, advance, realNow } = setup()
    await settle()
    const { token } = await ds.adminLogin("admin", "gym4200")
    const m = await ds.setMaintenance("LP01", { since: new Date(realNow()).toISOString(), reason: "Seat pin", expectedBack: null }, token)
    expect(m.maintenance?.reason).toBe("Seat pin")
    advance(1000)
    bridge.state("LP01", "ACTIVE")
    expect((await ds.getMachine("LP01")).state).toBe("AVAILABLE")
    advance(1000)
    const back = await ds.clearMaintenance("LP01", token)
    expect(back.maintenance).toBeNull()
    expect(back.state).toBe("ACTIVE")
    ds.dispose()
  })
})
