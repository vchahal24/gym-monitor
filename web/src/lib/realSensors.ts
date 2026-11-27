// REAL SENSOR NODES
// Purpose: turns what the bridge sends into Machine objects, history exclusions and recording info (hybrid mode)
// the real nodes only ever use their own recorded events, never simulated history

// config, layout, types and the shared lib pieces
import { MIN_RECORDED_HOURS } from "../config/real-sensors"
import { zoneOf, type machineLayout } from "../config/gym-layout"
import type { bridgeMachine, bridgeRecording, bridgeSpan } from "../types/bridge"
import type { Machine, maintenanceRecord, motionConfig, offlineRecord, recordingInfo, StateEvent } from "../types"
import type { downtimeWindow } from "./maintenance"

export interface realContext {
  bridgeConnected: boolean
  coordinatorConnected: boolean
  config: motionConfig
  fallbackSince: string // shown as since while the bridge has never answered
}

// the live Machine for a real node
// a node thats WAITING, in SENSOR_ERROR, or behind a dead bridge / unplugged coordinator gets online false
// so every live figure leaves it out exactly like OFFLINE (src/lib/eligibility.ts), machine.sensor says why
export function realMachine(layout: machineLayout, remote: bridgeMachine | null, ctx: realContext): Machine {
  const reachable = ctx.bridgeConnected && ctx.coordinatorConnected
  const online = !!remote && reachable && remote.online && !remote.sensorError && !remote.waiting
  return {
    id: layout.id,
    name: layout.name,
    zoneId: zoneOf(layout),
    group: layout.group,
    kind: layout.kind,
    state: remote?.state ?? "AVAILABLE",
    since: remote?.since ?? ctx.fallbackSince,
    sessionStartedAt: remote?.sessionStartedAt ?? null,
    maintenance: null,
    override: null,
    online,
    lastHeartbeat: remote?.lastHeartbeat ?? null,
    prototype: true,
    sensor: {
      dynamicG: remote?.dynamicG ?? null,
      xbeeAddress: remote?.xbeeAddress ?? null,
      bootId: remote?.bootId ?? null,
      revision: remote?.revision ?? null,
      onlineSince: remote?.onlineSince ?? null,
      waiting: remote ? remote.waiting : true,
      sensorError: remote ? remote.sensorError : false,
      bridgeConnected: ctx.bridgeConnected,
      coordinatorConnected: ctx.coordinatorConnected,
      offlineAfterSeconds: ctx.config.offlineAfterSeconds,
    },
    timing: {
      restingTimeoutSeconds: ctx.config.restingTimeoutSeconds,
      restingDelaySeconds: ctx.config.restingDelaySeconds,
      source: ctx.config.source,
    },
  }
}

export interface realExclusionInput {
  machineId: string
  spans: readonly bridgeSpan[] // from GET /api/machines/:id/offline
  recordingSince: string | null // null = the bridge was never reached
  bridgeDownSince: number | null // the bridge dropped at this time and hasnt come back yet
  maintenance: readonly maintenanceRecord[] // set from the admin page (frontend only in hybrid mode)
  from: number // start of the history window
  realNow: number
  dataNow: number // the data clock, ahead of real time when the demo is sped up
}

// every window that doesnt count towards a real nodes history, so heatmaps and utilisation are only built from
// time we actually recorded, never counted as 0 %
//   before recording started, offline / sensor error / bridge not running, since the bridge dropped,
//   the demos sim time past real time, and maintenance
export function realExclusions(x: realExclusionInput): downtimeWindow[] {
  const { machineId, realNow, dataNow } = x
  const out: downtimeWindow[] = []
  function add(start: number, end: number, reason: downtimeWindow["reason"]) {
    if (end > start) out.push({ machineId, start, end, reason })
  }
  const since = x.recordingSince ? Date.parse(x.recordingSince) : realNow
  add(x.from, since, "offline")
  for (const s of x.spans) add(Date.parse(s.since), s.end ? Date.parse(s.end) : realNow, "offline")
  if (x.bridgeDownSince !== null) add(x.bridgeDownSince, realNow, "offline")
  add(realNow, dataNow, "offline")
  for (const m of x.maintenance) add(Date.parse(m.since), m.end ? Date.parse(m.end) : dataNow, "maintenance")
  return out
}

// the bridges spans as offline records for MachineStats.offlineHistory (newest first)
export function offlineRecordsFromSpans(spans: readonly bridgeSpan[]): offlineRecord[] {
  return spans.map((s) => ({ since: s.since, end: s.end })).sort((a, b) => Date.parse(b.since) - Date.parse(a.since))
}

// how much real data a node has
export function recordingFor(machineId: string, recording: bridgeRecording | null, minHours = MIN_RECORDED_HOURS): recordingInfo {
  const hours = recording?.machines.find((m) => m.machineId === machineId)?.hours ?? 0
  return { since: recording?.startedAt ?? null, hours, enough: hours >= minHours }
}

// events in [from, to] from a time sorted list, withPrior also gives the one just before from
export function eventsInRange(events: readonly StateEvent[], from: number, to: number, withPrior = false): StateEvent[] {
  let lo = 0
  while (lo < events.length && Date.parse(events[lo].timestamp) < from) lo++
  let hi = lo
  while (hi < events.length && Date.parse(events[hi].timestamp) <= to) hi++
  return events.slice(withPrior ? Math.max(0, lo - 1) : lo, hi)
}

// adds live events to a recorded list, oldest first, skipping ones it already has
export function mergeEvents(base: readonly StateEvent[], extra: readonly StateEvent[]): StateEvent[] {
  const last = base.length ? Date.parse(base[base.length - 1].timestamp) : Number.NEGATIVE_INFINITY
  const out = [...base]
  for (const e of extra) {
    const t = Date.parse(e.timestamp)
    if (t <= last) continue
    if (out.length && out[out.length - 1].state === e.state) continue
    out.push(e)
  }
  return out
}
