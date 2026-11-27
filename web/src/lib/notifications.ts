// ADMIN NOTIFICATIONS
// Purpose: builds the list behind the admin bell, cleaning, service, offline nodes and long holds
// every notification id is stable per incident (for example the zone AND when it was last cleaned)
// so dismissing one only hides that incident, the next one still shows up

// thresholds, types + the cleaning alert rule
import { HOLD_ALERT_HOURS, SERVICE_EVERY_SESSIONS } from "../config/notifications"
import type { Machine, maintenanceRecord, StateEvent, zoneLoad } from "../types"
import { zoneAlert } from "./cleaning"

export type notificationKind = "cleaning" | "service" | "offline" | "hold"

export interface adminNotification {
  id: string
  kind: notificationKind
  severity: "warning" | "info"
  title: string
  detail: string
  href: string // admin page to open
  at: string // ISO, when it started (for sorting)
}

export interface notificationInput {
  now: number
  zones?: readonly zoneLoad[]
  zoneNames?: ReadonlyMap<string, string>
  machines: readonly Machine[]
  // last 4 weeks of events + maintenance history, for the service counts
  events?: readonly StateEvent[]
  maintenance?: ReadonlyMap<string, readonly maintenanceRecord[]>
}

// sessions each machine started since its last maintenance ended (or since the events begin)
export function sessionsSinceService(
  events: readonly StateEvent[],
  maintenance: ReadonlyMap<string, readonly maintenanceRecord[]>,
): Map<string, { count: number; since: string | null }> {
  const lastEnd = new Map<string, number>()
  for (const [id, recs] of maintenance) {
    const ends = recs.filter((r) => r.end).map((r) => Date.parse(r.end!))
    if (ends.length) lastEnd.set(id, Math.max(...ends))
  }
  const out = new Map<string, { count: number; since: string | null }>()
  const prev = new Map<string, string>()
  for (const e of events) {
    const p = prev.get(e.machineId)
    prev.set(e.machineId, e.state)
    if (!out.has(e.machineId)) {
      const t = lastEnd.get(e.machineId)
      out.set(e.machineId, { count: 0, since: t ? new Date(t).toISOString() : null })
    }
    if (e.state !== "ACTIVE" || (p !== undefined && p !== "AVAILABLE")) continue
    const since = lastEnd.get(e.machineId) ?? Number.NEGATIVE_INFINITY
    if (Date.parse(e.timestamp) >= since) out.get(e.machineId)!.count++
  }
  return out
}

// hours between iso and now
function hoursAgo(now: number, iso: string) {
  return (now - Date.parse(iso)) / 3_600_000
}

// "25 min", "2.5 h", "14 h"
function fmtHours(h: number) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 10) return `${h.toFixed(1).replace(/\.0$/, "")} h`
  return `${Math.round(h)} h`
}

// every notification that applies right now, warnings first then newest first
export function buildNotifications(input: notificationInput): adminNotification[] {
  const { now, machines } = input
  const out: adminNotification[] = []

  for (const z of input.zones ?? []) {
    const a = zoneAlert(z)
    if (!a.over) continue
    const name = input.zoneNames?.get(z.zoneId) ?? z.zoneId
    const what = a.reason === "sessions" ? `${z.sessionsSince} sessions` : `${Math.round(z.occupiedMinutesSince / 60)} machine-hours in use`
    out.push({
      id: `cleaning:${z.zoneId}:${z.lastCleaned}`,
      kind: "cleaning",
      severity: "warning",
      title: `${name} zone: ${what} since last clean, schedule a wipe-down`,
      detail: `Last cleaned ${fmtHours(hoursAgo(now, z.lastCleaned))} ago.`,
      href: "/admin/cleaning",
      at: z.lastCleaned,
    })
  }

  if (input.events && input.maintenance) {
    const counts = sessionsSinceService(input.events, input.maintenance)
    for (const m of machines) {
      const c = counts.get(m.id)
      if (!c || m.maintenance || c.count < SERVICE_EVERY_SESSIONS) continue
      out.push({
        id: `service:${m.id}:${c.since ?? "start"}`,
        kind: "service",
        severity: "info",
        title: `${m.name} (${m.id}) is due for service`,
        detail: `${c.count} sessions since ${c.since ? "its last maintenance" : "records began"} (service every ${SERVICE_EVERY_SESSIONS}).`,
        href: "/admin/maintenance",
        at: c.since ?? new Date(now).toISOString(),
      })
    }
  }

  for (const m of machines) {
    if (!m.online) {
      out.push({
        id: `offline:${m.id}:${m.lastHeartbeat ?? "never"}`,
        kind: "offline",
        severity: "warning",
        title: `Sensor node ${m.id} is offline`,
        detail: m.lastHeartbeat ? `${m.name}: no heartbeat for ${fmtHours(hoursAgo(now, m.lastHeartbeat))}.` : `${m.name}: no heartbeat received.`,
        href: "/admin/sensors",
        at: m.lastHeartbeat ?? new Date(now).toISOString(),
      })
    }
    if (m.override?.mode === "hold" && hoursAgo(now, m.override.at) > HOLD_ALERT_HOURS) {
      out.push({
        id: `hold:${m.id}:${m.override.at}`,
        kind: "hold",
        severity: "warning",
        title: `${m.name} (${m.id}) has been held for ${fmtHours(hoursAgo(now, m.override.at))}`,
        detail: `Held at ${m.state} by ${m.override.by}. Release it if it's no longer needed.`,
        href: "/admin/machine-control",
        at: m.override.at,
      })
    }
  }
  const rank = { warning: 0, info: 1 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || Date.parse(b.at) - Date.parse(a.at))
}
