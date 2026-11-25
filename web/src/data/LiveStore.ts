// LIVE STORE
// Purpose: the live picture of the gym that React reads, machines, recent events and connection status

import { applyEvent } from "../lib/machine"
import { startOfDay } from "../lib/time"
import type { connectionStatus, liveMessage, Machine, StateEvent } from "../types"
import type { DataSource } from "./DataSource"

// how far before midnight we keep events, so sessions over midnight still have their start
// and we know the state at midnight
const LEAD_MS = 6 * 3_600_000
const MAX_EVENTS = 40_000 // hard cap so a runaway feed cant eat memory forever (≈ 3 days of a 34 machine gym)

// start of the window we keep, 6 h before local midnight
export function windowStart(now: number): number {
  return startOfDay(new Date(now)).getTime() - LEAD_MS
}

export interface liveSnapshot {
  machines: Machine[]
  loaded: boolean
  error: string | null
  recentEvents: StateEvent[] // events from a bit before todays midnight onwards, oldest first
  status: connectionStatus
  revision: number // goes up on every live message, hooks use it to refetch derived data
}

// loads once then applies WebSocket messages as they come in
// React reads it through useSyncExternalStore (see src/hooks)
export class LiveStore {
  private snapshot: liveSnapshot
  private listeners = new Set<() => void>()
  private unsubs: (() => void)[] = []
  private buffer: liveMessage[] | null = null
  private started = false
  private ds: DataSource
  private now: () => number

  constructor(ds: DataSource, now: () => number = Date.now) {
    this.ds = ds
    this.now = now
    this.snapshot = {
      machines: [],
      loaded: false,
      error: null,
      recentEvents: [],
      status: ds.getConnectionStatus(),
      revision: 0,
    }
  }

  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  readonly getSnapshot = () => this.snapshot

  // subscribes and does the first load, messages that arrive mid load get buffered
  start() {
    if (this.started) return
    this.started = true
    this.buffer = []
    this.unsubs.push(
      this.ds.subscribe((m) => (this.buffer ? this.buffer.push(m) : this.apply(m))),
      this.ds.onConnectionStatus((status) => {
        this.set({ status })
        // after a reconnect we resync in case we missed messages
        if (status === "live" && this.snapshot.loaded) void this.load()
      }),
    )
    void this.load()
  }

  stop() {
    for (const u of this.unsubs) u()
    this.unsubs = []
    this.started = false
  }

  private async load() {
    try {
      const now = this.now()
      // a few hours before midnight too so we know the state at midnight
      const [machines, events] = await Promise.all([this.ds.getMachines(), this.ds.getEvents("ALL", new Date(windowStart(now)), new Date(now))])
      this.set({ machines, recentEvents: events.slice(-MAX_EVENTS), loaded: true, error: null })
      const pending = this.buffer ?? []
      this.buffer = null
      for (const m of pending) this.apply(m)
    } catch (err) {
      this.buffer = null
      this.set({ loaded: true, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // applies one WebSocket message to the snapshot
  private apply(msg: liveMessage) {
    const { machines, recentEvents, revision } = this.snapshot
    if (msg.type === "online") {
      this.set({
        machines: machines.map((m) => (m.id === msg.machineId ? { ...m, online: msg.online } : m)),
        revision: revision + 1,
      })
      return
    }
    if (msg.type === "maintenance" || msg.type === "override") {
      this.set({
        machines: machines.map((m) => (m.id === msg.machine.id ? msg.machine : m)),
        revision: revision + 1,
      })
      return
    }
    const e = msg.event
    const target = machines.find((m) => m.id === e.machineId)
    // skip events we already have (for example replayed after the initial load)
    if (target && Date.parse(e.timestamp) <= Date.parse(target.since)) return
    // keep everything since a bit before todays midnight, by time not count
    // (a busy day has well over 5000 events and today has to stay whole)
    const cutoff = windowStart(this.now())
    let drop = 0
    while (drop < recentEvents.length && Date.parse(recentEvents[drop].timestamp) < cutoff) drop++
    drop = Math.max(drop, recentEvents.length + 1 - MAX_EVENTS)
    const events = drop > 0 ? recentEvents.slice(drop) : recentEvents.slice()
    events.push(e)
    this.set({
      machines: machines.map((m) => applyEvent(m, e)),
      recentEvents: events,
      revision: revision + 1,
    })
  }

  private notifyQueued = false

  // updates the snapshot straight away but only tells React once per task
  // so a burst of messages (one mock tick at 240×, or a backlog after a reconnect) is one re-render not one per event
  private set(patch: Partial<liveSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    if (this.notifyQueued) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      for (const l of this.listeners) l()
    })
  }
}
