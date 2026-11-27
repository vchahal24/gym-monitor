// BRIDGE API v1 TYPES
// Purpose: the shapes the bridge (bridge/server.py) sends, docs/DATA_CONTRACT.md §4, used in hybrid mode only

import type { Machine, motionConfig, StateEvent } from "./index"

// a real node as the bridge sends it (contract §4)
export interface bridgeMachine extends Machine {
  status: "WAITING" | "AVAILABLE" | "ACTIVE" | "RESTING" | "SENSOR_ERROR" | "OFFLINE"
  waiting: boolean
  sensorError: boolean
  dynamicG: number | null
  xbeeAddress: string | null
  bootId: string | null
  revision: number | null
  onlineSince: string | null
  label: string
  mac: string
}

// a span without good data, GET /api/machines/:id/offline
export interface bridgeSpan {
  since: string
  end: string | null
  reason: "offline" | "sensor_error" | "not_recording"
}

// GET /api/recording
export interface bridgeRecording {
  startedAt: string
  now: string
  machines: { machineId: string; hours: number; firstEventAt: string | null }[]
}

export interface bridgeCoordinator {
  connected: boolean
  port: string | null
  address?: string | null
  channel?: number | null
}

// WS /ws messages
export type bridgeMessage =
  | { type: "snapshot"; machines: bridgeMachine[]; config: motionConfig; coordinator: bridgeCoordinator; recording: bridgeRecording }
  | { type: "state"; event: StateEvent; machine: bridgeMachine }
  | { type: "machine"; machine: bridgeMachine }
  | { type: "online"; machineId: string; online: boolean; machine: bridgeMachine }
  | { type: "heartbeat"; machineId: string; dynamicG: number; lastHeartbeat: string; revision: number }
  | ({ type: "coordinator" } & bridgeCoordinator)
