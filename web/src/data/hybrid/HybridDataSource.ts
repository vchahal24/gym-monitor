// HYBRID DATA SOURCE
// Purpose: the real sensor nodes (LE01, LP01) from the bridge, every other machine from the mock, merged into one DataSource
// pages and hooks dont know the difference, the gym wide figures run the same src/lib functions over both

// config, the shared lib, types and the two halves
import { GYM_LAYOUT, zoneOf, type machineLayout } from "../../config/gym-layout"
import { BRIDGE_FIRST_LOAD_WAIT_MS, BRIDGE_REFRESH_MS, FALLBACK_MOTION_CONFIG, MIN_RECORDED_HOURS, REAL_HISTORY_DAYS } from "../../config/real-sensors"
import { zoneLoads } from "../../lib/cleaning"
import { countsForLiveStats } from "../../lib/eligibility"
import { computeHeatmap } from "../../lib/heatmap"
import { computeKindAvailability } from "../../lib/kindAvailability"
import type { downtimeWindow } from "../../lib/maintenance"
import { eventsInRange, mergeEvents, offlineRecordsFromSpans, realExclusions, realMachine, recordingFor } from "../../lib/realSensors"
import { deriveSessions } from "../../lib/sessions"
import { computeMachineStats } from "../../lib/stats"
import { computeSummary, sessionsStartedToday } from "../../lib/summary"
import { addDays, startOfDay } from "../../lib/time"
import { fleetUtilisation, rankByValue, type fleetUtilisationType } from "../../lib/utilisation"
import type {
  bridgeStatus,
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
  motionConfig,
  OverrideLogEntry,
  overrideMode,
  recordingInfo,
  StateEvent,
  Summary,
  zoneLoad,
} from "../../types"
import type { bridgeMachine, bridgeMessage, bridgeRecording, bridgeSpan } from "../../types/bridge"
import type { bridgeInfo, DataSource, demoControls } from "../DataSource"
import { MockDataSource, type mockOptions } from "../mock/MockDataSource"
import { BridgeClient, type bridgeClientOptions, type bridgeLoad } from "./BridgeClient"

const DAY_MS = 86_400_000

// what the website shows for a real node instead of the sensor state, while held, after a one-off or a release
interface shownState {
  state: MachineState
  since: string
  sessionStartedAt: string | null
}

interface realNode {
  layout: machineLayout
  remote: bridgeMachine | null // the last thing the bridge said about it
  events: StateEvent[] // recorded real events, oldest first
  spans: bridgeSpan[] // recorded spans without good data
  maintenance: maintenanceRecord[] // frontend only in hybrid mode
  override: machineOverride | null // frontend only, a hold ignores sensor events until released
  shown: shownState | null // overrides the sensor state on screen, null = show the sensor
  demoHeld: boolean // demo panel hold (no lock badge, no audit entry)
}

export interface hybridOptions {
  apiURL: string
  now?: () => number // the data clock (the demos sim clock), the simulated machines run on it
  realNow?: () => number // the real nodes always run on real time
  mock?: mockOptions
  client?: bridgeClientOptions
  firstLoadWaitMs?: number
}

export class HybridDataSource implements DataSource {
  readonly kind = "hybrid" as const
  readonly demo: demoControls
  readonly bridge: bridgeInfo

  private mock: MockDataSource
  private client: BridgeClient
  private now: () => number
  private realNow: () => number
  private nodes = new Map<string, realNode>()
  private listeners = new Set<(m: liveMessage) => void>()
  private bridgeListeners = new Set<() => void>()
  private config: motionConfig | null = null
  private recording: bridgeRecording | null = null
  private coordinatorConnected = false
  private bridgeDownSince: number | null = null
  private realLog: OverrideLogEntry[] = []
  private ready: Promise<void>
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private unsubs: (() => void)[] = []
  private readonly startedAt: string

  constructor({ apiURL, now = Date.now, realNow = Date.now, mock = {}, client = {}, firstLoadWaitMs = BRIDGE_FIRST_LOAD_WAIT_MS }: hybridOptions) {
    this.now = now
    this.realNow = realNow
    this.startedAt = new Date(realNow()).toISOString()
    const real = GYM_LAYOUT.filter((l) => l.prototype)
    for (const layout of real) {
      this.nodes.set(layout.id, { layout, remote: null, events: [], spans: [], maintenance: [], override: null, shown: null, demoHeld: false })
    }
    this.mock = new MockDataSource({ now, ...mock, exclude: real.map((l) => l.id) })
    this.unsubs.push(this.mock.subscribe((m) => this.emit(m)))

    this.client = new BridgeClient(apiURL, client)
    this.unsubs.push(
      this.client.subscribe((e) => {
        if (e.kind === "loaded") void this.onLoaded(e.data)
        else if (e.kind === "message") this.onMessage(e.msg)
        else this.onStatus(e.status)
      }),
    )
    let loaded: () => void = () => {}
    const history = new Promise<void>((resolve) => (loaded = resolve))
    this.firstHistory = loaded
    // the first page load waits a moment for the bridge, after that the real machines show as not connected
    this.ready = Promise.race([
      this.client.firstLoad.then(() => (this.client.getStatus() === "bridge-offline" ? undefined : history)),
      new Promise<void>((resolve) => setTimeout(resolve, firstLoadWaitMs)),
    ])
    // what the page sees before the bridge answers, so the first real change is sent as a state event
    for (const id of this.nodes.keys()) this.lastSent.set(id, this.machineOf(id)!)
    this.client.start()
    this.refreshTimer = setInterval(() => {
      if (this.client.getStatus() !== "bridge-offline" && this.client.getStatus() !== "connecting") void this.refreshHistory()
    }, BRIDGE_REFRESH_MS)

    this.demo = this.makeDemo()
    this.bridge = {
      getStatus: () => this.client.getStatus(),
      getConfig: () => this.config,
      getRecording: (id) => this.recordingOf(id),
      getRecordingSince: () => this.recording?.startedAt ?? null,
      subscribe: (fn) => {
        this.bridgeListeners.add(fn)
        return () => this.bridgeListeners.delete(fn)
      },
    }
  }

  private firstHistory: () => void

  // ---------------- DATASOURCE ----------------

  async getMachines(): Promise<Machine[]> {
    await this.ready
    const sims = new Map((await this.mock.getMachines()).map((m) => [m.id, m]))
    return GYM_LAYOUT.map((l) => this.machineOf(l.id) ?? sims.get(l.id)!)
  }

  async getMachine(id: string): Promise<Machine> {
    return this.machineOf(id) ?? this.mock.getMachine(id)
  }

  async getMachineStats(id: string): Promise<MachineStats> {
    await this.ready
    const fleet = this.fleet()
    const node = this.nodes.get(id)
    if (!node) {
      const s = await this.mock.getMachineStats(id)
      const group = GYM_LAYOUT.find((l) => l.id === id)!.group
      return { ...s, rank: fleet.rank.get(id) ?? s.rank, groupAvgUtilisation: fleet.groupAvg.get(group) ?? s.groupAvgUtilisation }
    }
    const stats = computeMachineStats(this.machineOf(id)!, node.events, new Date(this.now()), {
      maintenanceHistory: node.maintenance,
      offlineHistory: offlineRecordsFromSpans(node.spans),
      fleet,
    })
    return { ...stats, recording: this.recordingOf(id) }
  }

  async getEvents(machineId: string | "ALL", from: Date, to: Date): Promise<StateEvent[]> {
    await this.ready
    const f = from.getTime()
    const t = to.getTime()
    const node = this.nodes.get(machineId)
    if (node) return eventsInRange(node.events, f, t)
    if (machineId !== "ALL") return this.mock.getEvents(machineId, from, to)
    const out = [...(await this.mock.getEvents("ALL", from, to)), ...[...this.nodes.values()].flatMap((n) => eventsInRange(n.events, f, t))]
    return out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  }

  async getHeatmap(machineId: string | "ALL", weeks = 4): Promise<Heatmap> {
    await this.ready
    const now = this.now()
    const from = addDays(startOfDay(new Date(now)), -weeks * 7).getTime()
    const node = this.nodes.get(machineId)
    if (node) {
      // real data only, and cells we never recorded say so instead of showing 0 %
      return computeHeatmap(eventsInRange(node.events, from, now, true), {
        machineId,
        machineIds: [machineId],
        now: new Date(now),
        weeks,
        downtime: this.realDowntime(node, from),
        withCoverage: true,
      })
    }
    if (machineId !== "ALL") return this.mock.getHeatmap(machineId, weeks)
    const { events, downtime } = this.merged(from, now)
    return computeHeatmap(events, { machineId, machineIds: GYM_LAYOUT.map((l) => l.id), now: new Date(now), weeks, downtime })
  }

  private kindCache: { key: string; at: number; value: KindAvailability[] } | null = null

  async getKindAvailability(weeks = 4): Promise<KindAvailability[]> {
    await this.ready
    const now = this.now()
    const machines = await this.getMachines()
    // only units in service right now count (see src/lib/eligibility.ts)
    const byKind = new Map<MachineKind, string[]>()
    for (const m of machines) {
      const list = byKind.get(m.kind) ?? []
      if (countsForLiveStats(m)) list.push(m.id)
      byKind.set(m.kind, list)
    }
    const kinds = [...byKind].map(([kind, units]) => ({ kind, units }))
    const key = `${weeks}:${kinds.map((k) => k.units.join(",")).join("|")}`
    if (this.kindCache && this.kindCache.key === key && now - this.kindCache.at < 60_000) return this.kindCache.value
    const from = addDays(startOfDay(new Date(now)), -weeks * 7).getTime()
    const { events, downtime } = this.merged(from, now)
    const value = computeKindAvailability(events, kinds, new Date(now), weeks, downtime).map((k) => {
      // a kind whose only units are real nodes still collecting has no history worth showing yet
      const all = GYM_LAYOUT.filter((l) => l.kind === k.kind)
      const collecting = all.every((l) => this.nodes.has(l.id) && !this.recordingOf(l.id).enough)
      return collecting ? { ...k, collectingData: true } : k
    })
    this.kindCache = { key, at: now, value }
    return value
  }

  async getSummary(): Promise<Summary> {
    await this.ready
    const now = new Date(this.now())
    const from = startOfDay(now).getTime() - 6 * 3_600_000
    const { events } = this.merged(from, now.getTime())
    return computeSummary(await this.getMachines(), sessionsStartedToday(deriveSessions(events), now))
  }

  subscribe(listener: (msg: liveMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // the simulated half is always "live", the bridge link has its own status (this.bridge)
  getConnectionStatus(): connectionStatus {
    return "mock"
  }

  onConnectionStatus(): () => void {
    return () => {}
  }

  dispose(): void {
    for (const u of this.unsubs) u()
    this.unsubs = []
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
    this.client.stop()
    this.mock.dispose()
    this.listeners.clear()
    this.bridgeListeners.clear()
  }

  // ---------------- ADMIN ----------------
  // the mocks demo login, real nodes get maintenance and overrides in the frontend only (the bridge keeps recording)

  adminLogin(username: string, password: string): Promise<{ token: string }> {
    return this.mock.adminLogin(username, password)
  }

  async setMaintenance(id: string, m: Maintenance, token: string): Promise<Machine> {
    const node = this.nodes.get(id)
    if (!node) return this.mock.setMaintenance(id, m, token)
    this.mock.adminName(token)
    return this.startMaintenance(node, m)
  }

  async clearMaintenance(id: string, token: string): Promise<Machine> {
    const node = this.nodes.get(id)
    if (!node) return this.mock.clearMaintenance(id, token)
    this.mock.adminName(token)
    return this.endMaintenance(node)
  }

  async setOverride(id: string, state: MachineState, mode: overrideMode, token: string): Promise<Machine> {
    const node = this.nodes.get(id)
    if (!node) return this.mock.setOverride(id, state, mode, token)
    const by = this.mock.adminName(token)
    if (!["AVAILABLE", "ACTIVE", "RESTING"].includes(state)) throw new Error(`Unknown state ${state}`)
    if (this.openMaintenance(node)) throw new Error(`${id} is in maintenance; clear that first`)
    const from = this.machineOf(id)!.state
    const at = this.force(node, state)
    node.override = { mode, by, at }
    this.realLog.push({ machineId: id, from, to: state, mode, by, at })
    return this.publish(node, "override")
  }

  async releaseOverride(id: string, token: string): Promise<Machine> {
    const node = this.nodes.get(id)
    if (!node) return this.mock.releaseOverride(id, token)
    this.mock.adminName(token)
    node.override = null
    this.backToSensor(node)
    return this.publish(node, "override")
  }

  async getOverrides(token: string): Promise<OverrideLogEntry[]> {
    const sims = await this.mock.getOverrides(token)
    return [...sims, ...this.realLog].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }

  async getZones(token: string): Promise<zoneLoad[]> {
    this.mock.adminName(token)
    return this.zones()
  }

  async markZoneCleaned(zoneId: string, token: string): Promise<zoneLoad> {
    await this.mock.markZoneCleaned(zoneId, token)
    return this.zones().find((z) => z.zoneId === zoneId)!
  }

  // cleaning load over the simulated and the real machines together
  private zones(): zoneLoad[] {
    const now = this.now()
    const cleaned = this.mock.cleanedAt()
    const { events } = this.merged(Math.min(...cleaned.values()), now)
    return zoneLoads(
      events,
      GYM_LAYOUT.map((l) => ({ id: l.id, zoneId: zoneOf(l) })),
      cleaned,
      now,
    )
  }

  // ---------------- BRIDGE ----------------

  private async onLoaded(data: bridgeLoad) {
    this.config = data.config
    this.recording = data.recording
    this.coordinatorConnected = data.coordinatorConnected
    this.bridgeDownSince = null
    for (const m of data.machines) this.updateRemote(m)
    await this.refreshHistory()
    this.firstHistory()
  }

  private onMessage(msg: bridgeMessage) {
    if (msg.type === "snapshot") {
      this.config = msg.config
      this.recording = msg.recording
      this.coordinatorConnected = msg.coordinator.connected
      for (const m of msg.machines) this.updateRemote(m)
      this.notifyBridge()
      return
    }
    if (msg.type === "coordinator") {
      this.coordinatorConnected = msg.connected
      for (const node of this.nodes.values()) this.publish(node)
      this.notifyBridge()
      return
    }
    if (msg.type === "heartbeat") {
      const node = this.nodes.get(msg.machineId)
      if (!node?.remote) return
      node.remote = { ...node.remote, dynamicG: msg.dynamicG, lastHeartbeat: msg.lastHeartbeat, revision: msg.revision }
      this.publish(node)
      return
    }
    const node = this.nodes.get(msg.machine.id)
    if (!node) return
    if (msg.type === "state") {
      // the bridge recorded it, so it goes into history whatever the website shows
      node.events = mergeEvents(node.events, [msg.event])
      this.invalidate()
    }
    this.updateRemote(msg.machine)
  }

  private onStatus(status: bridgeStatus) {
    if (status === "bridge-offline" && this.bridgeDownSince === null) this.bridgeDownSince = this.realNow()
    for (const node of this.nodes.values()) this.publish(node)
    this.invalidate()
    this.notifyBridge()
  }

  // a new picture of a node from the bridge
  // a held or maintenance machine keeps what its showing, otherwise the sensor state wins (a one-off marker clears)
  private updateRemote(m: bridgeMachine) {
    const node = this.nodes.get(m.id)
    if (!node) return
    const before = node.remote
    node.remote = m
    const changed = !before || before.state !== m.state || before.since !== m.since
    if (changed && !this.pinned(node)) {
      node.shown = null
      if (node.override?.mode === "one-off") node.override = null
    }
    this.publish(node)
  }

  // events, offline spans and recording hours from the bridge
  private async refreshHistory() {
    const real = this.realNow()
    const from = new Date(real - REAL_HISTORY_DAYS * DAY_MS)
    try {
      const [recording, ...perNode] = await Promise.all([
        this.client.recording(),
        ...[...this.nodes.values()].map(async (n) => ({
          node: n,
          events: await this.client.events(n.layout.id, from, new Date(real)),
          spans: await this.client.offline(n.layout.id, from),
        })),
      ])
      this.recording = recording
      for (const { node, events, spans } of perNode) {
        // keep live events that came in while the fetch was running
        node.events = mergeEvents(events, node.events)
        node.spans = spans
      }
    } catch {
      // the client notices a dead bridge on its own and reconnects
    }
    this.invalidate()
    this.notifyBridge()
  }

  // ---------------- REAL NODES ----------------

  // the Machine the website shows for a real node, undefined for a simulated id
  private machineOf(id: string): Machine | undefined {
    const node = this.nodes.get(id)
    if (!node) return undefined
    const status = this.client.getStatus()
    const base = realMachine(node.layout, node.remote, {
      bridgeConnected: status === "live" || status === "coordinator-unplugged",
      coordinatorConnected: this.coordinatorConnected,
      config: this.config ?? FALLBACK_MOTION_CONFIG,
      fallbackSince: this.startedAt,
    })
    const open = this.openMaintenance(node)
    return {
      ...base,
      ...(node.shown ?? {}),
      maintenance: open ? { since: open.since, reason: open.reason, expectedBack: open.expectedBack } : null,
      override: node.override,
    }
  }

  // shown state is pinned (sensor events dont change it) while held or in maintenance
  private pinned(node: realNode): boolean {
    return node.demoHeld || node.override?.mode === "hold" || !!this.openMaintenance(node)
  }

  private openMaintenance(node: realNode): maintenanceRecord | undefined {
    return node.maintenance.find((r) => r.end === null)
  }

  // shows a state now (override or demo), never ACTIVE→AVAILABLE in one step, that goes via RESTING
  private force(node: realNode, state: MachineState): string {
    let at = Math.max(this.realNow(), Date.parse(this.machineOf(node.layout.id)!.since) + 1)
    const current = this.machineOf(node.layout.id)!
    if (current.state === "ACTIVE" && state === "AVAILABLE") {
      node.shown = { state: "RESTING", since: new Date(at++).toISOString(), sessionStartedAt: current.sessionStartedAt }
      this.publish(node)
    }
    const prev = this.machineOf(node.layout.id)!
    let sessionStartedAt = prev.sessionStartedAt
    if (state === "AVAILABLE") sessionStartedAt = null
    else if (prev.state === "AVAILABLE" || !sessionStartedAt) sessionStartedAt = new Date(at).toISOString()
    node.shown = { state, since: new Date(at).toISOString(), sessionStartedAt }
    return node.shown.since
  }

  // after a hold or maintenance ends, carry on from the sensor (as a change now, so since never goes backwards)
  private backToSensor(node: realNode) {
    if (this.pinned(node)) return
    const shown = this.machineOf(node.layout.id)!
    const sensor = node.remote
    if (!sensor || sensor.state === shown.state) {
      node.shown = sensor ? null : node.shown
      return
    }
    const at = new Date(Math.max(this.realNow(), Date.parse(shown.since) + 1)).toISOString()
    node.shown = { state: sensor.state, since: at, sessionStartedAt: sensor.state === "AVAILABLE" ? null : (sensor.sessionStartedAt ?? at) }
  }

  private startMaintenance(node: realNode, m: Maintenance): Machine {
    const current = this.machineOf(node.layout.id)!
    const open = this.openMaintenance(node)
    if (open) Object.assign(open, m)
    else node.maintenance.push({ ...m, end: null })
    // frozen in whatever it showed
    node.shown = { state: current.state, since: current.since, sessionStartedAt: current.sessionStartedAt }
    this.invalidate()
    return this.publish(node, "maintenance")
  }

  private endMaintenance(node: realNode): Machine {
    const open = this.openMaintenance(node)
    if (open) open.end = new Date(this.realNow()).toISOString()
    this.backToSensor(node)
    this.invalidate()
    return this.publish(node, "maintenance")
  }

  // sends what changed about a real node, a state event first if the shown state moved, then the whole machine
  private lastSent = new Map<string, Machine>()

  private publish(node: realNode, type: "machine" | "override" | "maintenance" = "machine"): Machine {
    const machine = this.machineOf(node.layout.id)!
    const prev = this.lastSent.get(machine.id)
    if (prev && prev.state !== machine.state) {
      this.emit({ type: "state", event: { machineId: machine.id, state: machine.state, timestamp: machine.since } })
    }
    this.lastSent.set(machine.id, machine)
    this.emit({ type, machine })
    return machine
  }

  private recordingOf(id: string): recordingInfo {
    return recordingFor(id, this.recording, MIN_RECORDED_HOURS)
  }

  private realDowntime(node: realNode, from: number): downtimeWindow[] {
    return realExclusions({
      machineId: node.layout.id,
      spans: node.spans,
      recordingSince: this.recording?.startedAt ?? null,
      bridgeDownSince: this.client.getStatus() === "live" || this.client.getStatus() === "coordinator-unplugged" ? null : (this.bridgeDownSince ?? from),
      maintenance: node.maintenance,
      from,
      realNow: this.realNow(),
      dataNow: Math.max(this.now(), this.realNow()),
    })
  }

  // ---------------- MERGED HISTORY ----------------

  // simulated + real events in [from, to] (with the event before from) and every machines exclusions
  private merged(from: number, to: number): { events: StateEvent[]; downtime: downtimeWindow[] } {
    const sim = this.mock.history(from, to)
    const events = [...sim.events]
    const downtime = [...sim.downtime]
    for (const node of this.nodes.values()) {
      events.push(...eventsInRange(node.events, from, to, true))
      downtime.push(...this.realDowntime(node, from))
    }
    events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    return { events, downtime }
  }

  private fleetCache: { at: number; value: fleetUtilisationType } | null = null

  // utilisation, rank and group averages over all 31 machines
  // real nodes still collecting data are left out of the rank and the group average (admin shows "collecting data")
  private fleet(): fleetUtilisationType {
    const now = this.now()
    if (this.fleetCache && now - this.fleetCache.at < 30_000) return this.fleetCache.value
    const from = addDays(startOfDay(new Date(now)), -28).getTime()
    const { events, downtime } = this.merged(from, now)
    const all = fleetUtilisation(
      events,
      GYM_LAYOUT.map((l) => ({ id: l.id, group: l.group })),
      new Date(now),
      downtime,
    )
    const counted = GYM_LAYOUT.filter((l) => !this.nodes.has(l.id) || this.recordingOf(l.id).enough)
    const rank = rankByValue(new Map(counted.map((l) => [l.id, all.rates.get(l.id)!.fourWeeks])))
    for (const l of GYM_LAYOUT) if (!rank.has(l.id)) rank.set(l.id, counted.length + 1)
    const sums = new Map<string, { s: number; n: number }>()
    for (const l of counted) {
      const g = sums.get(l.group) ?? { s: 0, n: 0 }
      g.s += all.rates.get(l.id)!.fourWeeks
      g.n++
      sums.set(l.group, g)
    }
    const value = { rates: all.rates, rank, groupAvg: new Map([...sums].map(([g, { s, n }]) => [g, s / n])) }
    this.fleetCache = { at: now, value }
    return value
  }

  private invalidate() {
    this.fleetCache = null
    this.kindCache = null
  }

  // ---------------- DEMO ----------------

  // the mocks demo controls for the simulated machines, real nodes cant be driven by scenarios
  // but a demo hold and demo maintenance work on them in the frontend
  private makeDemo(): demoControls {
    const d = this.mock.demo
    const real = (id: string) => this.nodes.get(id)
    return {
      forceState: (id, state, opts) => {
        const node = real(id)
        if (!node) return d.forceState(id, state, opts)
        if (this.openMaintenance(node)) return
        this.force(node, state)
        node.demoHeld = opts?.hold ?? false
        this.publish(node)
      },
      release: (id) => {
        const node = real(id)
        if (!node) return d.release(id)
        node.demoHeld = false
        this.backToSensor(node)
        this.publish(node)
      },
      isHeld: (id) => real(id)?.demoHeld ?? d.isHeld(id),
      setOnline: (id, online) => {
        if (!real(id)) d.setOnline(id, online)
      },
      setPaused: (p) => d.setPaused(p),
      isPaused: () => d.isPaused(),
      startSession: (id) => {
        if (!real(id)) d.startSession(id)
      },
      leave: (id) => {
        if (!real(id)) d.leave(id)
      },
      rush: () => d.rush(),
      quiet: (minutes) => d.quiet(minutes),
      setMaintenance: (id, reason) => {
        const node = real(id)
        if (!node) return d.setMaintenance(id, reason)
        if (reason) this.startMaintenance(node, { since: new Date(this.realNow()).toISOString(), reason, expectedBack: null })
        else this.endMaintenance(node)
      },
      isRealSensor: (id) => this.nodes.has(id),
    }
  }

  // ---------------- MESSAGES ----------------

  private emit(msg: liveMessage) {
    for (const l of [...this.listeners]) l(msg)
  }

  private notifyBridge() {
    for (const l of [...this.bridgeListeners]) l()
  }
}
