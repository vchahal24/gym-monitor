// API DATA SOURCE
// Purpose: REST + WebSocket client for the backend in docs/DATA_CONTRACT.md §3

import type {
  connectionStatus,
  Heatmap,
  KindAvailability,
  liveMessage,
  Machine,
  MachineState,
  MachineStats,
  Maintenance,
  OverrideLogEntry,
  overrideMode,
  StateEvent,
  Summary,
  zoneLoad,
} from "../types"
import { AuthError, notFoundError, type DataSource } from "./DataSource"

// WebSocket reconnect backoff, doubles each time up to the max
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 15_000

export class ApiDataSource implements DataSource {
  readonly kind = "api" as const

  private listeners = new Set<(m: liveMessage) => void>()
  private statusListeners = new Set<(s: connectionStatus) => void>()
  private status: connectionStatus = "connecting"
  private ws: WebSocket | null = null
  private retryMs = RECONNECT_MIN_MS
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private baseURL: string

  constructor(baseURL: string) {
    this.baseURL = baseURL.replace(/\/$/, "")
  }

  getMachines() {
    return this.get<Machine[]>("/api/machines")
  }

  getMachine(id: string) {
    return this.get<Machine>(`/api/machines/${encodeURIComponent(id)}`)
  }

  async getMachineStats(id: string): Promise<MachineStats> {
    const s = await this.get<MachineStats>(`/api/machines/${encodeURIComponent(id)}/stats`)
    // contract v4 field, so cope with a backend that doesnt send it yet
    return { ...s, offlineHistory: s.offlineHistory ?? [] }
  }

  async getEvents(machineId: string | "ALL", from: Date, to: Date): Promise<StateEvent[]> {
    const q = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
    if (machineId !== "ALL") {
      return this.get<StateEvent[]>(`/api/machines/${encodeURIComponent(machineId)}/events?${q}`)
    }
    // NOTE: the contract has no events endpoint for the whole gym yet so we fetch per machine
    // a GET /api/events?from=&to= on the backend would replace this
    const machines = await this.getMachines()
    const lists = await Promise.all(machines.map((m) => this.getEvents(m.id, from, to)))
    return lists.flat().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  }

  getHeatmap(machineId: string | "ALL", weeks = 4) {
    return this.get<Heatmap>(`/api/heatmap?machineId=${encodeURIComponent(machineId)}&weeks=${weeks}`)
  }

  getKindAvailability(weeks = 4) {
    return this.get<KindAvailability[]>(`/api/kinds/availability?weeks=${weeks}`)
  }

  async getSummary(): Promise<Summary> {
    const s = await this.get<Summary>("/api/summary")
    // contract v4 fields, work them out if an older backend leaves them out
    const reporting = s.reporting ?? s.available + s.active + s.resting
    return { ...s, reporting, offline: s.offline ?? Math.max(0, s.operational - reporting) }
  }

  adminLogin(username: string, password: string) {
    return this.send<{ token: string }>("POST", "/api/admin/login", { username, password })
  }

  setMaintenance(id: string, maintenance: Maintenance, token: string) {
    return this.send<Machine>("PUT", `/api/admin/machines/${encodeURIComponent(id)}/maintenance`, maintenance, token)
  }

  clearMaintenance(id: string, token: string) {
    return this.send<Machine>("DELETE", `/api/admin/machines/${encodeURIComponent(id)}/maintenance`, undefined, token)
  }

  setOverride(id: string, state: MachineState, mode: overrideMode, token: string) {
    return this.send<Machine>("PUT", `/api/admin/machines/${encodeURIComponent(id)}/state`, { state, mode }, token)
  }

  releaseOverride(id: string, token: string) {
    return this.send<Machine>("DELETE", `/api/admin/machines/${encodeURIComponent(id)}/state`, undefined, token)
  }

  getOverrides(token: string) {
    return this.send<OverrideLogEntry[]>("GET", "/api/admin/overrides", undefined, token)
  }

  getZones(token: string) {
    return this.send<zoneLoad[]>("GET", "/api/admin/zones", undefined, token)
  }

  markZoneCleaned(zoneId: string, token: string) {
    // ASSUMPTION: the contract doesnt say what this returns, we assume the updated zone load
    return this.send<zoneLoad>("POST", `/api/admin/zones/${encodeURIComponent(zoneId)}/cleaned`, undefined, token)
  }

  subscribe(listener: (msg: liveMessage) => void): () => void {
    this.listeners.add(listener)
    this.connect()
    return () => this.listeners.delete(listener)
  }

  getConnectionStatus() {
    return this.status
  }

  onConnectionStatus(listener: (s: connectionStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  dispose() {
    this.disposed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
    this.statusListeners.clear()
  }

  // ---------------- INTERNALS ----------------

  // GET as JSON, 404 -> notFoundError

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.baseURL + path, { headers: { Accept: "application/json" } })
    if (res.status === 404) throw new notFoundError(path)
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`)
    return (await res.json()) as T
  }

  // any method with an optional JSON body and admin token, 401 / 403 -> AuthError
  private async send<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" }
    if (body !== undefined) headers["Content-Type"] = "application/json"
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(this.baseURL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    if (res.status === 401 || res.status === 403) throw new AuthError(res.status === 401 ? "Wrong username or password, or session expired" : "Not allowed")
    if (res.status === 404) throw new notFoundError(path)
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText}`)
    return (await res.json()) as T
  }

  // opens the WebSocket, and reconnects with backoff if it closes
  private connect() {
    if (this.ws || this.disposed) return
    this.setStatus("connecting")
    const url = this.baseURL.replace(/^http/, "ws") + "/ws"
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.retryMs = RECONNECT_MIN_MS
      this.setStatus("live")
    }
    ws.onmessage = (e) => {
      let msg: liveMessage
      try {
        msg = JSON.parse(String(e.data)) as liveMessage
      } catch {
        return
      }
      if (msg && (msg.type === "state" || msg.type === "online" || msg.type === "maintenance" || msg.type === "override")) {
        for (const l of this.listeners) l(msg)
      }
    }
    ws.onclose = () => {
      this.ws = null
      if (!this.disposed) this.scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  }

  private scheduleReconnect() {
    this.setStatus("disconnected")
    this.retryTimer = setTimeout(() => this.connect(), this.retryMs)
    this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS)
  }

  private setStatus(s: connectionStatus) {
    if (s === this.status) return
    this.status = s
    for (const l of this.statusListeners) l(s)
  }
}
