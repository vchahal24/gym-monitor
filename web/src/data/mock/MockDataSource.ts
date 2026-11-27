// MOCK DATA SOURCE
// Purpose: the whole system simulated in the browser so the site runs with no hardware or backend

// config, the shared src/lib logic (same as the backend will use), types and the traffic model
import { closingTime, nextOpening } from "../../config/gym-hours"
import { RESTING_TIMEOUT_MS } from "../../config/state-machine"
import { GYM_LAYOUT, type machineLayout } from "../../config/gym-layout"
import { computeHeatmap } from "../../lib/heatmap"
import { computeKindAvailability } from "../../lib/kindAvailability"
import { countsForLiveStats } from "../../lib/eligibility"
import { machinesFromEvents } from "../../lib/machine"
import { historyExclusions } from "../../lib/eligibility"
import type { downtimeWindow } from "../../lib/maintenance"
import { deriveSessions } from "../../lib/sessions"
import { computeMachineStats } from "../../lib/stats"
import { computeSummary, sessionsStartedToday } from "../../lib/summary"
import { fleetUtilisation, type fleetUtilisationType } from "../../lib/utilisation"
import { addDays, MS_PER_MINUTE, MS_PER_SECOND, startOfDay } from "../../lib/time"
import type {
  connectionStatus,
  Heatmap,
  KindAvailability,
  liveMessage,
  Machine,
  MachineKind,
  MachineState,
  MachineStats,
  Maintenance,
  machineOverride,
  maintenanceRecord,
  offlineRecord,
  OverrideLogEntry,
  overrideMode,
  StateEvent,
  Summary,
  zoneLoad,
} from "../../types"
import { zoneLoads } from "../../lib/cleaning"
import { zoneOf } from "../../config/gym-layout"
import { AuthError, notFoundError, type DataSource, type demoControls } from "../DataSource"
import {
  CARDIO_KINDS,
  DEFAULT_POPULARITY,
  MACHINE_POPULARITY,
  mulberry32,
  nextArrival,
  planContinuation,
  planSession,
  type plannedEvent,
  type rngType,
} from "./simulation"

const HISTORY_DAYS = 29 // ~4 weeks of history + today
const TICK_MS = 250 // one live step every 250 ms real time
// nodes send a heartbeat every 30 s (contract §1)
const HEARTBEAT_MS = 30 * MS_PER_SECOND
const DAY_MS = 86_400_000

interface machineSim {
  layout: machineLayout
  index: number
  // the nodes own state, while its offline it keeps running but the backend hears nothing
  // so this can be different from the last recorded event
  state: MachineState
  lastAt: number
  queue: plannedEvent[]
  held: boolean // demo panel hold (no lock badge, no audit entry)
  override: machineOverride | null // admin override, "hold" freezes the machine until released
  online: boolean
  offlineAt: number | null // when the node went quiet (for lastHeartbeat), if offline
  offline: offlineRecord[] // offline spells (the open one has end null)
  events: StateEvent[] // what the backend has received
  times: number[] // epoch ms of each event lined up with events, for fast range lookups
  maintenance: maintenanceRecord[]
}

// maintenance seed data, in days from today (negative = past)
interface maintenanceSeed {
  id: string
  fromDay: number
  fromHour: number
  toDay: number | null // null = still in maintenance
  toHour?: number
  reason: string
  expectedBackDay?: number // days from today, for open records
}

const MAINTENANCE_SEED: maintenanceSeed[] = [
  // out of service right now
  { id: "TM03", fromDay: -4, fromHour: 10.25, toDay: null, reason: "Belt slipping under load; motor service booked", expectedBackDay: 2 },
  // the only pec deck, so the planner shows "Pec deck: out of service"
  { id: "PD01", fromDay: -6, fromHour: 8.5, toDay: null, reason: "Frayed cable on the arm pulley; replacement on order", expectedBackDay: 3 },
  // in the past, fixed since
  { id: "CX01", fromDay: -21, fromHour: 13, toDay: -21, toHour: 17, reason: "Noisy pulley bearing replaced" },
  { id: "CX01", fromDay: -13, fromHour: 7.5, toDay: -12, toHour: 15, reason: "Frayed cable on the left stack replaced" },
  { id: "LP01", fromDay: -18, fromHour: 9, toDay: -17, toHour: 16, reason: "Seat adjustment pin sticking" },
  { id: "LPD01", fromDay: -23, fromHour: 7, toDay: -22, toHour: 12, reason: "Cable replaced after wear check" },
  { id: "TM01", fromDay: -11, fromHour: 6.5, toDay: -11, toHour: 13, reason: "Belt lubrication and calibration" },
  { id: "TM03", fromDay: -20, fromHour: 15, toDay: -19, toHour: 11, reason: "Emergency stop key replaced" },
  { id: "SM01", fromDay: -26, fromHour: 8, toDay: -25, toHour: 18, reason: "Bar catch hooks re-aligned" },
  { id: "BK01", fromDay: -9, fromHour: 12, toDay: -9, toHour: 15, reason: "Pedal crank tightened" },
]

// one node has gone quiet (battery) so sensor health has something to show
const OFFLINE_SEED: { id: string; minutesAgo: number } = { id: "RW02", minutesAgo: 25 }

// hours before the page loaded that each zone was last cleaned (so the cleaning page has something to show)
const CLEANED_HOURS_AGO: Record<string, number> = { legs: 10, "chest-shoulders-triceps": 4, "back-biceps": 7, cardio: 2.5 }

// demo login (mock mode only, shown on the login page)
export const MOCK_ADMIN = { username: "admin", password: "gym4200" } as const

export interface mockOptions {
  seed?: number
  now?: () => number
  live?: boolean // start the live simulation timer (off in tests)
  // machines this mock leaves out (hybrid mode: the real nodes come from the bridge instead)
  // the others are simulated exactly as in mock mode
  exclude?: readonly string[]
}

// simulates the whole system in the browser
// makes ~4 weeks of event history then keeps the state machines running live, sending the same
// WebSocket messages the backend will
// all the stats come from the event log with the same src/lib functions the backend should copy
export class MockDataSource implements DataSource {
  readonly kind = "mock" as const
  readonly demo: demoControls

  private sims = new Map<string, machineSim>()
  private listeners = new Set<(m: liveMessage) => void>()
  private rng: rngType
  private now: () => number
  private liveStart: number
  private timer: ReturnType<typeof setInterval> | null = null
  private paused = false

  constructor({ seed = 4200, now = Date.now, live = true, exclude = [] }: mockOptions = {}) {
    this.rng = mulberry32(seed)
    this.now = now
    this.liveStart = now()
    for (const [zone, h] of Object.entries(CLEANED_HOURS_AGO)) this.cleaned.set(zone, this.liveStart - h * 3_600_000)
    const today = startOfDay(new Date(this.liveStart))
    const historyStart = addDays(today, -HISTORY_DAYS).getTime()

    // build each machines history from the start, in layout order (the rng order depends on it)
    for (let index = 0; index < GYM_LAYOUT.length; index++) {
      const layout = GYM_LAYOUT[index]
      const t0 = new Date(historyStart).toISOString()
      const sim: machineSim = {
        layout,
        index,
        state: "AVAILABLE",
        lastAt: historyStart,
        queue: [],
        held: false,
        override: null,
        online: true,
        offlineAt: null,
        offline: [],
        events: [{ machineId: layout.id, state: "AVAILABLE", timestamp: t0 }],
        times: [historyStart],
        maintenance: seedMaintenance(layout.id, today, this.liveStart),
      }
      this.sims.set(layout.id, sim)

      if (layout.id === OFFLINE_SEED.id) {
        // heard as normal until the node went quiet, then it carries on unheard
        const quietAt = this.liveStart - OFFLINE_SEED.minutesAgo * MS_PER_MINUTE
        this.advance(sim, quietAt, false)
        sim.online = false
        sim.offlineAt = quietAt
        sim.offline.push({ since: new Date(quietAt).toISOString(), end: null })
      }
      this.advance(sim, this.liveStart, false)
    }
    // built and then dropped so the rest get the same history as in mock mode (the rng runs in layout order)
    for (const id of exclude) this.sims.delete(id)

    this.demo = {
      forceState: (id, state, opts) => this.forceState(id, state, opts?.hold ?? false),
      release: (id) => this.release(id),
      isHeld: (id) => this.sims.get(id)?.held ?? false,
      setOnline: (id, online) => this.setOnline(id, online),
      setPaused: (p) => {
        this.paused = p
      },
      isPaused: () => this.paused,
      startSession: (id) => {
        const sim = this.sim(id)
        if (this.frozen(sim) || !sim.online) return
        // a real start, AVAILABLE → ACTIVE or back to work from a rest
        this.forceState(id, "ACTIVE", false)
      },
      leave: (id) => this.leave(id),
      rush: () => {
        let n = 0
        for (const sim of this.sims.values()) {
          if (this.frozen(sim) || !sim.online || sim.state !== "AVAILABLE" || this.rng() > 0.8) continue
          this.forceState(sim.layout.id, "ACTIVE", false)
          n++
        }
        this.quietUntil = 0
        return n
      },
      quiet: (minutes) => {
        this.quietUntil = this.now() + minutes * MS_PER_MINUTE
        for (const sim of this.sims.values()) {
          if (this.frozen(sim)) continue
          if (sim.state === "AVAILABLE") sim.queue = []
          else this.leave(sim.layout.id)
        }
      },
      setMaintenance: (id, reason) => {
        if (reason) this.applyMaintenance(id, { since: new Date(this.now()).toISOString(), reason, expectedBack: null })
        else this.endMaintenance(id)
      },
    }

    if (live) this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  // ---------------- DATASOURCE ----------------

  async getMachines(): Promise<Machine[]> {
    return [...this.sims.values()].map((s) => this.machineOf(s))
  }

  async getMachine(id: string): Promise<Machine> {
    return this.machineOf(this.sim(id))
  }

  async getMachineStats(id: string): Promise<MachineStats> {
    const sim = this.sim(id)
    return computeMachineStats(this.machineOf(sim), sim.events, new Date(this.now()), {
      maintenanceHistory: sim.maintenance,
      offlineHistory: sim.offline,
      fleet: this.fleet(),
    })
  }

  async getEvents(machineId: string | "ALL", from: Date, to: Date): Promise<StateEvent[]> {
    const f = from.getTime()
    const t = to.getTime()
    const sims = machineId === "ALL" ? [...this.sims.values()] : [this.sim(machineId)]
    const out = sims.flatMap((s) => eventsBetween(s, f, t))
    if (sims.length > 1) out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    return out
  }

  async getHeatmap(machineId: string | "ALL", weeks = 4): Promise<Heatmap> {
    const sims = machineId === "ALL" ? [...this.sims.values()] : [this.sim(machineId)]
    const now = new Date(this.now())
    const from = addDays(startOfDay(now), -weeks * 7).getTime()
    return computeHeatmap(
      sims.flatMap((s) => eventsBetween(s, from, now.getTime(), true)),
      { machineId, machineIds: sims.map((s) => s.layout.id), now, weeks, downtime: this.downtime(sims) },
    )
  }

  private kindCache: { key: string; at: number; value: KindAvailability[] } | null = null

  async getKindAvailability(weeks = 4): Promise<KindAvailability[]> {
    const now = this.now()
    const sims = [...this.sims.values()]
    // only units in service right now count (see src/lib/eligibility.ts)
    const byKind = new Map<MachineKind, string[]>()
    for (const s of sims) {
      const list = byKind.get(s.layout.kind) ?? []
      if (countsForLiveStats(this.machineOf(s))) list.push(s.layout.id)
      byKind.set(s.layout.kind, list)
    }
    const kinds = [...byKind].map(([kind, units]) => ({ kind, units }))
    const key = `${weeks}:${kinds.map((k) => k.units.join(",")).join("|")}`
    if (this.kindCache && this.kindCache.key === key && now - this.kindCache.at < 60_000) return this.kindCache.value
    const from = addDays(startOfDay(new Date(now)), -weeks * 7).getTime()
    const value = computeKindAvailability(
      sims.flatMap((s) => eventsBetween(s, from, now, true)),
      kinds,
      new Date(now),
      weeks,
      this.downtime(sims),
    )
    this.kindCache = { key, at: now, value }
    return value
  }

  async getSummary(): Promise<Summary> {
    const now = new Date(this.now())
    // start a few hours before midnight so sessions spanning it have their real start
    const from = startOfDay(now).getTime() - 6 * 3_600_000
    const recent = [...this.sims.values()].flatMap((s) => eventsBetween(s, from, now.getTime(), true))
    const machines = [...this.sims.values()].map((s) => this.machineOf(s))
    return computeSummary(machines, sessionsStartedToday(deriveSessions(recent), now))
  }

  subscribe(listener: (msg: liveMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getConnectionStatus(): connectionStatus {
    return "mock"
  }

  onConnectionStatus(): () => void {
    return () => {}
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.listeners.clear()
  }

  // ---------------- HYBRID MODE ----------------

  // every simulated machines events in [from, to] (with the one before from) and its maintenance + offline windows
  // so hybrid mode can work out gym wide figures over the simulated and the real machines together
  history(from: number, to: number): { events: StateEvent[]; downtime: downtimeWindow[] } {
    const sims = [...this.sims.values()]
    const events = sims.flatMap((s) => eventsBetween(s, from, to, true))
    events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    return { events, downtime: this.downtime(sims) }
  }

  // the admins username for a token, rejects with AuthError like every admin call
  adminName(token: string): string {
    return this.checkToken(token)
  }

  // when each zone was last cleaned (epoch ms)
  cleanedAt(): ReadonlyMap<string, number> {
    return this.cleaned
  }

  // ---------------- ADMIN ----------------

  // demo login for mock mode only, this is NOT real security because the login ships in the frontend bundle
  // the real backend has to check it server side
  async adminLogin(username: string, password: string): Promise<{ token: string }> {
    if (username !== MOCK_ADMIN.username || password !== MOCK_ADMIN.password) throw new AuthError("Wrong username or password")
    const token = `mock-${Math.floor(Math.random() * 2 ** 48)
      .toString(36)
      .padStart(8, "0")}`
    this.tokens.set(token, username)
    return { token }
  }

  async setMaintenance(id: string, m: Maintenance, token: string): Promise<Machine> {
    this.checkToken(token)
    return this.applyMaintenance(id, m)
  }

  async clearMaintenance(id: string, token: string): Promise<Machine> {
    this.checkToken(token)
    return this.endMaintenance(id)
  }

  async setOverride(id: string, state: MachineState, mode: overrideMode, token: string): Promise<Machine> {
    const by = this.checkToken(token)
    if (!["AVAILABLE", "ACTIVE", "RESTING"].includes(state)) throw new Error(`Unknown state ${state}`)
    return this.applyOverride(id, state, mode, by)
  }

  async releaseOverride(id: string, token: string): Promise<Machine> {
    this.checkToken(token)
    return this.releaseHold(id)
  }

  async getOverrides(token: string): Promise<OverrideLogEntry[]> {
    this.checkToken(token)
    return [...this.overrideLog].reverse()
  }

  async getZones(token: string): Promise<zoneLoad[]> {
    this.checkToken(token)
    return this.zones()
  }

  async markZoneCleaned(zoneId: string, token: string): Promise<zoneLoad> {
    this.checkToken(token)
    if (!this.cleaned.has(zoneId)) throw new notFoundError(`Zone ${zoneId}`)
    this.cleaned.set(zoneId, this.now())
    return this.zones().find((z) => z.zoneId === zoneId)!
  }

  private tokens = new Map<string, string>()
  private overrideLog: OverrideLogEntry[] = []
  private cleaned = new Map<string, number>()

  // returns the admins username
  // tokens from this page load are valid, and a well formed "mock-" token is accepted too so a
  // sessionStorage session survives a reload in the demo, anything else (empty, made up) gets rejected
  // its not security, in mock mode everything runs in the visitors browser
  private checkToken(token: string | null | undefined): string {
    if (typeof token !== "string" || !token) throw new AuthError("Not signed in")
    const known = this.tokens.get(token)
    if (known) return known
    if (/^mock-[0-9a-z]{8,}$/.test(token)) return MOCK_ADMIN.username
    throw new AuthError("Session expired")
  }

  private zones(): zoneLoad[] {
    const now = this.now()
    const from = Math.min(...this.cleaned.values())
    const sims = [...this.sims.values()]
    return zoneLoads(
      sims.flatMap((s) => eventsBetween(s, from, now, true)),
      sims.map((s) => ({ id: s.layout.id, zoneId: zoneOf(s.layout) })),
      this.cleaned,
      now,
    )
  }

  // ---------------- OVERRIDES ----------------

  // admin state override, skips the timing rules (instant change) but never sends ACTIVE→AVAILABLE, that goes via RESTING
  private applyOverride(id: string, state: MachineState, mode: overrideMode, by: string): Machine {
    const sim = this.sim(id)
    if (inMaintenanceAt(sim, this.now())) throw new Error(`${id} is in maintenance; clear that first`)
    const from = sim.state
    let at = Math.max(this.now(), sim.lastAt + 1)
    // an admin override is set on the backend, so its recorded even if the node is offline
    if (sim.state === "ACTIVE" && state === "AVAILABLE") this.record(sim, "RESTING", at++, true, false)
    this.record(sim, state, at, true, false)
    sim.override = { mode, by, at: new Date(at).toISOString() }
    sim.queue =
      mode === "hold" ? [] : state === "RESTING" ? [{ state: "AVAILABLE", at: at + RESTING_TIMEOUT_MS }] : planContinuation(state, at, isCardio(sim), this.rng)
    this.overrideLog.push({ machineId: id, from, to: state, mode, by, at: sim.override.at })
    const machine = this.machineOf(sim)
    this.emit({ type: "override", machine })
    return machine
  }

  private releaseHold(id: string): Machine {
    const sim = this.sim(id)
    if (sim.override) {
      sim.override = null
      if (!this.frozen(sim)) sim.queue = this.continuation(sim)
    }
    const machine = this.machineOf(sim)
    this.emit({ type: "override", machine })
    return machine
  }

  // ---------------- MAINTENANCE ----------------

  // puts a machine into maintenance, it freezes until its cleared
  applyMaintenance(id: string, m: Maintenance): Machine {
    const sim = this.sim(id)
    const open = sim.maintenance.find((r) => r.end === null)
    if (open) Object.assign(open, m)
    else sim.maintenance.push({ ...m, end: null })
    sim.queue = []
    const machine = this.machineOf(sim)
    this.emit({ type: "maintenance", machine })
    return machine
  }

  endMaintenance(id: string): Machine {
    const sim = this.sim(id)
    const open = sim.maintenance.find((r) => r.end === null)
    if (open) open.end = new Date(this.now()).toISOString()
    sim.queue = this.continuation(sim)
    const machine = this.machineOf(sim)
    this.emit({ type: "maintenance", machine })
    return machine
  }

  // ---------------- SIMULATION ----------------

  // runs one live step, public so tests can move time along by hand
  tick(): void {
    if (this.paused) return
    const now = this.now()
    // at high speed one tick covers lots of sim seconds (60 s at 240×)
    // so every queued change gets replayed at its own timestamp (no skips, no drift)
    // and the batch goes out in time order across machines
    this.batch = []
    try {
      for (const sim of this.sims.values()) {
        if (!this.frozen(sim)) this.advance(sim, now, true)
      }
    } finally {
      const out = this.batch
      this.batch = null
      out.sort((a, b) => a.at - b.at)
      for (const o of out) this.send(o.msg)
    }
  }

  // messages held during a tick so they can be sent in time order
  private batch: { at: number; msg: liveMessage }[] | null = null

  // held by the demo or an admin, or in maintenance, so the simulation leaves it alone
  // (an offline node is NOT frozen, it keeps running unheard)
  private frozen(sim: machineSim): boolean {
    return sim.held || sim.override?.mode === "hold" || inMaintenanceAt(sim, this.now())
  }

  private advance(sim: machineSim, until: number, emit: boolean) {
    for (let guard = 0; guard < 100_000; guard++) {
      if (sim.queue.length === 0 && !this.plan(sim)) return
      const next = sim.queue[0]
      if (next.at > until) return
      sim.queue.shift()
      this.record(sim, next.state, next.at, emit)
      // a one off override lasts until the next change from the sensor
      if (sim.override?.mode === "one-off") {
        sim.override = null
        if (emit) this.emit({ type: "override", machine: this.machineOf(sim) })
      }
    }
  }

  // plans the next visit. Returns false if the machine wont be used again (open maintenance)
  private plan(sim: machineSim): boolean {
    let from = Math.max(sim.lastAt, this.quietUntil)
    for (let guard = 0; guard < 200; guard++) {
      const start = nextArrival(
        from,
        { index: sim.index, popularity: MACHINE_POPULARITY[sim.layout.id] ?? DEFAULT_POPULARITY, cardio: isCardio(sim) },
        this.rng,
      )
      // nobody starts a visit within an hour of a planned maintenance slot, or during one
      const clash = sim.maintenance.find((r) => {
        const s = Date.parse(r.since)
        const e = r.end ? Date.parse(r.end) : Number.POSITIVE_INFINITY
        return start >= s - 60 * MS_PER_MINUTE && start < e
      })
      if (!clash) {
        const queue = planSession(start, isCardio(sim), this.rng)
        // nobody starts a visit they cant finish before closing time
        if (queue.length && queue[queue.length - 1].at > closingTime(start).getTime()) {
          from = nextOpening(start).getTime()
          continue
        }
        sim.queue = queue
        return true
      }
      if (!clash.end) return false
      from = Date.parse(clash.end)
    }
    return false
  }

  // a state change, fromNode ones are packets from the sensor node
  // while its offline they never reach the backend (only the nodes own state moves)
  private record(sim: machineSim, state: MachineState, at: number, emit: boolean, fromNode = true) {
    if (state === sim.state) return
    sim.state = state
    sim.lastAt = at
    if (fromNode && !sim.online) return
    this.store(sim, state, at, emit)
  }

  // appends an event the backend received
  private store(sim: machineSim, state: MachineState, at: number, emit: boolean) {
    const event: StateEvent = { machineId: sim.layout.id, state, timestamp: new Date(at).toISOString() }
    sim.events.push(event)
    sim.times.push(at)
    if (emit) this.emit({ type: "state", event })
  }

  // demo override, skips the timing rules (the presenter wants an instant change)
  // but never sends ACTIVE→AVAILABLE, that goes via RESTING
  private forceState(id: string, state: MachineState, hold: boolean) {
    const sim = this.sim(id)
    let now = Math.max(this.now(), sim.lastAt + 1)
    sim.held = hold
    if (sim.state === "ACTIVE" && state === "AVAILABLE") this.record(sim, "RESTING", now++, true)
    this.record(sim, state, now, true)
    sim.queue = hold ? [] : planContinuation(state, now, isCardio(sim), this.rng)
  }

  // demo quiet scenario, nobody new arrives before this time
  private quietUntil = 0

  // the current person stops, RESTING now (via ACTIVE if needed) and AVAILABLE after the full timeout
  private leave(id: string) {
    const sim = this.sim(id)
    if (this.frozen(sim) || !sim.online) return
    let at = Math.max(this.now(), sim.lastAt + 1)
    if (sim.state === "AVAILABLE") this.record(sim, "ACTIVE", at++, true)
    if (sim.state === "ACTIVE") this.record(sim, "RESTING", at, true)
    sim.queue = [{ state: "AVAILABLE", at: sim.lastAt + RESTING_TIMEOUT_MS }]
  }

  private release(id: string) {
    const sim = this.sim(id)
    if (!sim.held) return
    sim.held = false
    if (!this.frozen(sim)) sim.queue = this.continuation(sim)
  }

  // the node stops / starts reaching the coordinator
  // while its offline it keeps running but nothing gets recorded
  // when it comes back its first packet carries its current state, which re-syncs the backend
  // NOTE: the firmware needs to send its state when it (re)joins the network, heartbeats alone dont carry the state
  private setOnline(id: string, online: boolean) {
    const sim = this.sim(id)
    if (sim.online === online) return
    const now = this.now()
    sim.online = online
    sim.offlineAt = online ? null : now
    if (online) {
      const open = sim.offline.find((r) => r.end === null)
      if (open) open.end = new Date(now).toISOString()
    } else sim.offline.push({ since: new Date(now).toISOString(), end: null })
    this.fleetCache = null
    this.emit({ type: "online", machineId: id, online })
    // timestamped when received, the nodes own timers (sim.lastAt) carry on the same
    if (online && sim.events[sim.events.length - 1].state !== sim.state) {
      this.store(sim, sim.state, Math.max(now, sim.times[sim.times.length - 1] + 1), true)
    }
  }

  // plan the rest of the current session, keeping the resting timer from when the rest began
  private continuation(sim: machineSim): plannedEvent[] {
    const now = this.now()
    if (sim.state === "RESTING") return [{ state: "AVAILABLE", at: Math.max(now, sim.lastAt + RESTING_TIMEOUT_MS) }]
    return planContinuation(sim.state, now, isCardio(sim), this.rng)
  }

  private emit(msg: liveMessage) {
    if (this.batch) {
      const at = msg.type === "state" ? Date.parse(msg.event.timestamp) : this.now()
      // array sort is stable so a machines own messages keep their order on ties
      this.batch.push({ at, msg })
      return
    }
    this.send(msg)
  }

  private send(msg: liveMessage) {
    for (const l of this.listeners) l(msg)
  }

  private sim(id: string): machineSim {
    const s = this.sims.get(id)
    if (!s) throw new notFoundError(`Machine ${id}`)
    return s
  }

  private fleetCache: { at: number; value: fleetUtilisationType } | null = null

  // utilisation for every machine (for rank / group average), cached briefly
  private fleet(): fleetUtilisationType {
    const now = this.now()
    if (this.fleetCache && now - this.fleetCache.at < 30_000) return this.fleetCache.value
    const sims = [...this.sims.values()]
    const from = addDays(startOfDay(new Date(now)), -28).getTime()
    const value = fleetUtilisation(
      sims.flatMap((s) => eventsBetween(s, from, now, true)),
      sims.map((s) => ({ id: s.layout.id, group: s.layout.group })),
      new Date(now),
      this.downtime(sims),
    )
    this.fleetCache = { at: now, value }
    return value
  }

  private downtime(sims: readonly machineSim[]): downtimeWindow[] {
    const now = this.now()
    // maintenance and offline time are both left out of history (src/lib/eligibility.ts)
    return sims.flatMap((s) => historyExclusions(s.layout.id, s.maintenance, s.offline, now))
  }

  private machineOf(sim: machineSim): Machine {
    // rebuild from the event log the same way the backend would
    let i = sim.events.length - 1
    while (i > 0 && sim.events[i].state !== "AVAILABLE") i--
    const tail = sim.events.slice(i)
    const now = this.now()
    const open = sim.maintenance.find((r) => r.end === null)
    // heartbeats arrive every 30 s, staggered per node
    const phase = (sim.index * 7_919) % HEARTBEAT_MS
    const lastHb = sim.offlineAt ?? now - ((((now - phase) % HEARTBEAT_MS) + HEARTBEAT_MS) % HEARTBEAT_MS)
    const [m] = machinesFromEvents([sim.layout], tail, tail[0].timestamp, () => ({
      online: sim.online,
      lastHeartbeat: new Date(lastHb).toISOString(),
      maintenance: open ? { since: open.since, reason: open.reason, expectedBack: open.expectedBack } : null,
      override: sim.override,
    }))
    return m
  }
}

function isCardio(sim: machineSim): boolean {
  return CARDIO_KINDS.has(sim.layout.kind)
}

function inMaintenanceAt(sim: machineSim, t: number): boolean {
  return sim.maintenance.some((r) => Date.parse(r.since) <= t && (r.end === null || Date.parse(r.end) > t))
}

function seedMaintenance(id: string, today: Date, now: number): maintenanceRecord[] {
  function at(day: number, hour: number) {
    return new Date(addDays(today, day).getTime() + hour * 3_600_000).toISOString()
  }
  return MAINTENANCE_SEED.filter((s) => s.id === id)
    .map((s) => ({
      since: at(s.fromDay, s.fromHour),
      reason: s.reason,
      expectedBack: s.expectedBackDay !== undefined ? at(s.expectedBackDay, 12) : null,
      end: s.toDay === null ? null : at(s.toDay, s.toHour ?? 17),
    }))
    .filter((r) => Date.parse(r.since) < now - DAY_MS / 24)
}

// events in [from, to] by binary search
// withPrior also includes the event just before from so we know the state at from
function eventsBetween(sim: machineSim, from: number, to: number, withPrior = false): StateEvent[] {
  const { times, events } = sim
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < from) lo = mid + 1
    else hi = mid
  }
  const start = withPrior ? Math.max(0, lo - 1) : lo
  let end = lo
  while (end < times.length && times[end] <= to) end++
  return events.slice(start, end)
}
