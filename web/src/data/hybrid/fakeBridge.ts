// FAKE BRIDGE (tests only)
// Purpose: a stand in for bridge/server.py, a mock fetch and WebSocket that speak Bridge API v1

import type { motionConfig, StateEvent } from "../../types"
import type { bridgeMachine, bridgeMessage, bridgeRecording, bridgeSpan } from "../../types/bridge"

// the bits of a WebSocket the BridgeClient uses
export class fakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false

  close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
}

export interface fakeBridgeOptions {
  realNow: () => number
  recordingStartedAt?: number
}

export class fakeBridge {
  up = true
  coordinator = true
  config: motionConfig = { restingTimeoutSeconds: 3, restingDelaySeconds: 0.4, thresholdG: 0.1, offlineAfterSeconds: 16, source: "motion.h" }
  machines = new Map<string, bridgeMachine>()
  events = new Map<string, StateEvent[]>()
  spans = new Map<string, bridgeSpan[]>()
  hours = new Map<string, number>()
  sockets: fakeSocket[] = []
  requests: string[] = []
  recordingStartedAt: number
  private realNow: () => number

  constructor({ realNow, recordingStartedAt }: fakeBridgeOptions) {
    this.realNow = realNow
    this.recordingStartedAt = recordingStartedAt ?? realNow() - 3_600_000
    for (const [id, name, kind, mac] of [
      ["LE01", "Leg Extension", "leg-extension", "24dcc3458a78"],
      ["LP01", "Seated Leg Press", "leg-press", "ac1518ebf918"],
    ] as const) {
      const since = new Date(this.recordingStartedAt).toISOString()
      this.machines.set(id, {
        id,
        name,
        zoneId: "legs",
        group: "legs",
        kind,
        state: "AVAILABLE",
        since,
        sessionStartedAt: null,
        maintenance: null,
        override: null,
        online: true,
        lastHeartbeat: since,
        prototype: true,
        status: "AVAILABLE",
        waiting: false,
        sensorError: false,
        dynamicG: 0.02,
        xbeeAddress: id === "LE01" ? "0013A20041F0AA01" : "0013A20041F0AA02",
        bootId: "0a1b2c3d",
        revision: 1,
        onlineSince: since,
        label: id === "LE01" ? "Machine 1" : "Machine 2",
        mac,
      })
      this.events.set(id, [{ machineId: id, state: "AVAILABLE", timestamp: since }])
      this.spans.set(id, [])
      this.hours.set(id, 1)
    }
  }

  recording(): bridgeRecording {
    return {
      startedAt: new Date(this.recordingStartedAt).toISOString(),
      now: new Date(this.realNow()).toISOString(),
      machines: [...this.machines.keys()].map((id) => ({ machineId: id, hours: this.hours.get(id) ?? 0, firstEventAt: this.events.get(id)?.[0]?.timestamp ?? null })),
    }
  }

  // the mock fetch, routes like bridge/server.py
  fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input))
    this.requests.push(url.pathname)
    if (!this.up) throw new TypeError("fetch failed")
    const path = url.pathname
    let body: unknown
    if (path === "/api/config") body = this.config
    else if (path === "/api/health") body = { coordinatorConnected: this.coordinator }
    else if (path === "/api/machines") body = [...this.machines.values()]
    else if (path === "/api/recording") body = this.recording()
    else {
      const m = path.match(/^\/api\/machines\/([^/]+)\/(events|offline)$/)
      if (!m) return new Response("not found", { status: 404 })
      const id = decodeURIComponent(m[1])
      if (m[2] === "offline") body = this.spans.get(id) ?? []
      else {
        const from = Date.parse(url.searchParams.get("from") ?? "1970-01-01T00:00:00Z")
        const list = this.events.get(id) ?? []
        const first = list.findIndex((e) => Date.parse(e.timestamp) >= from)
        body = first < 0 ? list.slice(-1) : list.slice(Math.max(0, first - 1))
      }
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
  }

  // the mock WebSocket factory
  openSocket = (): WebSocket => {
    const s = new fakeSocket()
    if (!this.up) {
      queueMicrotask(() => s.close())
      return s as unknown as WebSocket
    }
    this.sockets.push(s)
    queueMicrotask(() => {
      s.onopen?.()
      this.send(s, {
        type: "snapshot",
        machines: [...this.machines.values()],
        config: this.config,
        coordinator: { connected: this.coordinator, port: "/dev/ttyUSB0" },
        recording: this.recording(),
      })
    })
    return s as unknown as WebSocket
  }

  // a real state change, recorded and pushed like the bridge does
  state(id: string, state: bridgeMachine["state"], at = this.realNow()) {
    const m = this.machines.get(id)!
    const timestamp = new Date(at).toISOString()
    const sessionStartedAt = state === "AVAILABLE" ? null : m.state === "AVAILABLE" ? timestamp : m.sessionStartedAt
    const next = { ...m, state, status: state, since: timestamp, sessionStartedAt, lastHeartbeat: timestamp, revision: (m.revision ?? 0) + 1 }
    this.machines.set(id, next)
    const event = { machineId: id, state, timestamp }
    this.events.get(id)!.push(event)
    this.push({ type: "state", event, machine: next })
  }

  // a sensor error or anything else that isnt a machine state change
  patch(id: string, fields: Partial<bridgeMachine>) {
    const next = { ...this.machines.get(id)!, ...fields }
    this.machines.set(id, next)
    this.push({ type: "machine", machine: next })
  }

  push(msg: bridgeMessage) {
    for (const s of this.sockets) if (!s.closed) this.send(s, msg)
  }

  // the bridge process dies, every socket drops and nothing answers
  stop() {
    this.up = false
    const open = this.sockets
    this.sockets = []
    for (const s of open) s.close()
  }

  start() {
    this.up = true
  }

  private send(s: fakeSocket, msg: bridgeMessage) {
    s.onmessage?.({ data: JSON.stringify(msg) })
  }
}
