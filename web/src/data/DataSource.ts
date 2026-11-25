// DATA SOURCE INTERFACE
// Purpose: the one interface all UI data goes through (see docs/DATA_CONTRACT.md)
// MockDataSource (simulation in the browser) and ApiDataSource (REST + WebSocket) both implement it
// components never use it directly, they go through the hooks in src/hooks

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

export interface DataSource {
  readonly kind: "mock" | "api"

  // GET /api/machines
  getMachines(): Promise<Machine[]>
  // GET /api/machines/:id
  getMachine(id: string): Promise<Machine>
  // GET /api/machines/:id/stats
  getMachineStats(id: string): Promise<MachineStats>
  // GET /api/machines/:id/events?from=&to= ("ALL" = every machine, merged by time)
  getEvents(machineId: string | "ALL", from: Date, to: Date): Promise<StateEvent[]>
  // GET /api/heatmap?machineId=&weeks=
  getHeatmap(machineId: string | "ALL", weeks?: number): Promise<Heatmap>
  // GET /api/summary
  getSummary(): Promise<Summary>
  // GET /api/kinds/availability?weeks= , per machine kind how often at least one in service unit was free
  // and how many usually were
  getKindAvailability(weeks?: number): Promise<KindAvailability[]>

  // POST /api/admin/login, rejects with AuthError on a bad login
  adminLogin(username: string, password: string): Promise<{ token: string }>
  // PUT /api/admin/machines/:id/maintenance (auth)
  setMaintenance(id: string, maintenance: Maintenance, token: string): Promise<Machine>
  // DELETE /api/admin/machines/:id/maintenance (auth)
  clearMaintenance(id: string, token: string): Promise<Machine>
  // PUT /api/admin/machines/:id/state (auth)
  //   one-off: the machine carries on from this state as normal
  //   hold: it ignores sensor events until released
  // rejects with AuthError without a valid admin token
  setOverride(id: string, state: MachineState, mode: overrideMode, token: string): Promise<Machine>
  // DELETE /api/admin/machines/:id/state (auth), releases a hold
  releaseOverride(id: string, token: string): Promise<Machine>
  // GET /api/admin/overrides (auth), the audit log newest first
  getOverrides(token: string): Promise<OverrideLogEntry[]>
  // GET /api/admin/zones (auth), load since each zone was last cleaned
  getZones(token: string): Promise<zoneLoad[]>
  // POST /api/admin/zones/:zoneId/cleaned (auth)
  markZoneCleaned(zoneId: string, token: string): Promise<zoneLoad>

  // WS /ws, returns a function to unsubscribe
  subscribe(listener: (msg: liveMessage) => void): () => void

  getConnectionStatus(): connectionStatus
  onConnectionStatus(listener: (status: connectionStatus) => void): () => void

  readonly demo?: demoControls // mock mode only, controls for the live demo

  // stops timers / closes sockets
  dispose(): void
}

export interface demoControls {
  // forces a machine into a state now, with hold the simulation leaves it alone until release
  forceState(machineId: string, state: MachineState, opts?: { hold?: boolean }): void
  release(machineId: string): void
  isHeld(machineId: string): boolean
  setOnline(machineId: string, online: boolean): void
  // pauses or resumes all the automatic simulation
  setPaused(paused: boolean): void
  isPaused(): boolean
  // someone starts a session now (the simulation plays it out)
  startSession(machineId: string): void
  // the person stops and walks off, RESTING now and AVAILABLE after the timeout
  leave(machineId: string): void
  // most free machines get someone at once, returns how many started
  rush(): number
  // everyone finishes up and nobody new shows up for that many minutes (sim time)
  quiet(minutes: number): void
  // demo maintenance without a login (reason null = back in service)
  setMaintenance(machineId: string, reason: string | null): void
}

// no machine (or whatever) with that id
export class notFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = "NotFoundError"
  }
}

// bad login, or a missing / expired admin token
export class AuthError extends Error {
  constructor(message = "Not authorised") {
    super(message)
    this.name = "AuthError"
  }
}
