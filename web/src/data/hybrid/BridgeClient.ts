// BRIDGE CLIENT
// Purpose: REST + WebSocket link to the bridge (bridge/server.py, Bridge API v1 in docs/DATA_CONTRACT.md §4)
// loads over REST, then follows the WebSocket, and reconnects with backoff when the bridge goes away

import { BRIDGE_RETRY_FIRST_MS, BRIDGE_RETRY_MAX_MS } from "../../config/real-sensors"
import type { bridgeStatus, motionConfig, StateEvent } from "../../types"
import type { bridgeMachine, bridgeMessage, bridgeRecording, bridgeSpan } from "../../types/bridge"

// what a REST load brings back
export interface bridgeLoad {
  config: motionConfig
  machines: bridgeMachine[]
  recording: bridgeRecording
  coordinatorConnected: boolean
}

export type bridgeClientEvent = { kind: "loaded"; data: bridgeLoad } | { kind: "message"; msg: bridgeMessage } | { kind: "status"; status: bridgeStatus }

export interface bridgeClientOptions {
  fetchFn?: typeof fetch
  openSocket?: (url: string) => WebSocket
  retryFirstMs?: number
  retryMaxMs?: number
}

// ---------------- CLIENT ----------------

export class BridgeClient {
  private status: bridgeStatus = "connecting"
  private listeners = new Set<(e: bridgeClientEvent) => void>()
  private socket: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private stopped = false
  private coordinatorConnected = true
  private readonly baseURL: string
  private readonly fetchFn: typeof fetch
  private readonly openSocket: (url: string) => WebSocket
  private readonly retryFirstMs: number
  private readonly retryMaxMs: number
  private resolveFirst: () => void = () => {}
  // settles after the first load attempt, whether or not the bridge answered
  readonly firstLoad: Promise<void>

  constructor(baseURL: string, opts: bridgeClientOptions = {}) {
    this.baseURL = baseURL.replace(/\/+$/, "")
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init))
    this.openSocket = opts.openSocket ?? ((url) => new WebSocket(url))
    this.retryFirstMs = opts.retryFirstMs ?? BRIDGE_RETRY_FIRST_MS
    this.retryMaxMs = opts.retryMaxMs ?? BRIDGE_RETRY_MAX_MS
    this.firstLoad = new Promise((resolve) => (this.resolveFirst = resolve))
  }

  start() {
    this.stopped = false
    void this.connect()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const ws = this.socket
    this.socket = null
    ws?.close()
    this.listeners.clear()
  }

  getStatus(): bridgeStatus {
    return this.status
  }

  subscribe(listener: (e: bridgeClientEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // recorded events for one real machine, with the one before from so the starting state is known
  events(machineId: string, from: Date, to: Date): Promise<StateEvent[]> {
    return this.get(`/api/machines/${encodeURIComponent(machineId)}/events?from=${from.toISOString()}&to=${to.toISOString()}&prior=true`)
  }

  offline(machineId: string, from: Date): Promise<bridgeSpan[]> {
    return this.get(`/api/machines/${encodeURIComponent(machineId)}/offline?from=${from.toISOString()}`)
  }

  recording(): Promise<bridgeRecording> {
    return this.get("/api/recording")
  }

  // ---------------- CONNECTION ----------------

  // REST load first, then the WebSocket for live updates
  private async connect() {
    try {
      const [config, machines, recording, health] = await Promise.all([
        this.get<motionConfig>("/api/config"),
        this.get<bridgeMachine[]>("/api/machines"),
        this.get<bridgeRecording>("/api/recording"),
        this.get<{ coordinatorConnected: boolean }>("/api/health"),
      ])
      if (this.stopped) return
      this.coordinatorConnected = health.coordinatorConnected
      this.emit({ kind: "loaded", data: { config, machines, recording, coordinatorConnected: health.coordinatorConnected } })
      this.setStatus(this.coordinatorConnected ? "live" : "coordinator-unplugged")
      this.listen()
    } catch {
      this.retry()
    } finally {
      this.resolveFirst()
    }
  }

  private listen() {
    if (this.stopped) return
    let ws: WebSocket
    try {
      ws = this.openSocket(`${this.baseURL.replace(/^http/, "ws")}/ws`)
    } catch {
      this.retry()
      return
    }
    this.socket = ws
    ws.onopen = () => {
      this.attempt = 0
    }
    ws.onmessage = (ev: MessageEvent) => {
      let msg: bridgeMessage
      try {
        msg = JSON.parse(String(ev.data)) as bridgeMessage
      } catch {
        return
      }
      if (msg.type === "coordinator" || msg.type === "snapshot") {
        this.coordinatorConnected = msg.type === "coordinator" ? msg.connected : msg.coordinator.connected
        this.setStatus(this.coordinatorConnected ? "live" : "coordinator-unplugged")
      }
      this.emit({ kind: "message", msg })
    }
    ws.onclose = () => {
      if (this.socket !== ws) return
      this.socket = null
      this.retry()
    }
  }

  // bridge unreachable or dropped, try again after 1 s, 2 s, 4 s … up to the max
  private retry() {
    if (this.stopped) return
    this.setStatus("bridge-offline")
    const wait = Math.min(this.retryMaxMs, this.retryFirstMs * 2 ** this.attempt)
    this.attempt++
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.connect()
    }, wait)
  }

  private setStatus(status: bridgeStatus) {
    if (status === this.status) return
    this.status = status
    this.emit({ kind: "status", status })
  }

  private emit(e: bridgeClientEvent) {
    for (const l of [...this.listeners]) l(e)
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.baseURL}${path}`)
    if (!res.ok) throw new Error(`Bridge ${path}: ${res.status}`)
    return (await res.json()) as T
  }
}
