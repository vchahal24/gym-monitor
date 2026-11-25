// DATA HOOKS
// Purpose: every hook components get data through, nothing imports a data source directly

import { useMemo, useState, useSyncExternalStore } from "react"
import { FLOOR_ZONES, GYM_LAYOUT } from "../config/gym-layout"
import { buildNotifications } from "../lib/notifications"
import { readJSON, writeJSON } from "../lib/storage"
import { adminSession } from "../data/adminSession"
import { AuthError, notFoundError, type demoControls } from "../data/DataSource"
import { busiestBlockToday, type busiestTodayType } from "../lib/summary"
import { countsForLiveStats, currentExclusions, isFreeNow } from "../lib/eligibility"
import type { connectionStatus, Heatmap, Machine, MachineState, MachineStats, Maintenance, overrideMode, StateEvent, Summary } from "../types"
import { buildPlannerKinds, type plannerData } from "../lib/planner"
import { useDataContext, useDebounced, useFetch, useLiveSnapshot } from "./internal"
import { useNow } from "./useNow"

const HEATMAP_REFRESH_MS = 5 * 60_000 // heatmaps barely change so every 5 min is plenty

// all machines with their live state
export function useMachines(): { machines: Machine[]; loading: boolean; error: string | null } {
  const snap = useLiveSnapshot()
  return { machines: snap.machines, loading: !snap.loaded, error: snap.error }
}

// one machines live state plus its stats (refetched when its state changes)
export function useMachine(id: string): {
  machine: Machine | undefined
  stats: MachineStats | undefined
  loading: boolean
  notFound: boolean
} {
  const { ds } = useDataContext()
  const snap = useLiveSnapshot()
  const machine = snap.machines.find((m) => m.id === id)
  const key = machine ? `${id}#${machine.since}|${machine.maintenance?.since ?? ""}` : null
  const stats = useFetch(key, () => ds.getMachineStats(id))
  const notFound = snap.loaded && !machine && !snap.error
  return {
    machine,
    stats: stats.data,
    loading: !snap.loaded || (!!machine && stats.loading),
    notFound: notFound || stats.error instanceof notFoundError,
  }
}

// gym summary, refreshed a bit after each live event, plus todays busiest block
export function useSummary(): { summary: Summary | undefined; busiestToday: busiestTodayType | null; loading: boolean } {
  const { ds } = useDataContext()
  const snap = useLiveSnapshot()
  const revision = useDebounced(snap.revision, 300)
  const { data, loading } = useFetch(snap.loaded ? `summary#${revision}` : null, () => ds.getSummary())
  const minute = useNow(60_000)
  const ids = useMemo(() => snap.machines.map((m) => m.id), [snap.machines])
  const busiestToday = useMemo(
    // machines in maintenance or offline right now dont count for that time
    () => (ids.length ? busiestBlockToday(snap.recentEvents, ids, minute, currentExclusions(snap.machines, minute.getTime())) : null),
    // recompute on new events and once a minute
    [snap.recentEvents, ids, minute, snap.machines],
  )
  return { summary: data, busiestToday, loading }
}

// weekly heatmap for one machine, or the whole gym if theres no machineId
export function useHeatmap(machineId?: string, weeks = 4): { heatmap: Heatmap | undefined; loading: boolean; error?: Error } {
  const { ds } = useDataContext()
  const id = machineId ?? "ALL"
  const tick = useNow(HEATMAP_REFRESH_MS)
  const { data, loading, error } = useFetch(`${id}:${weeks}#${tick.getTime()}`, () => ds.getHeatmap(id, weeks))
  return { heatmap: data, loading, error }
}

export interface feedItem extends StateEvent {
  previous: MachineState | null // the machines state before this event, if known
}

// most recent state changes, newest first (optionally for one machine)
export function useEvents(limit = 20, machineId?: string): feedItem[] {
  const { recentEvents } = useLiveSnapshot()
  return useMemo(() => {
    const out: feedItem[] = []
    for (let i = recentEvents.length - 1; i >= 0 && out.length < limit; i--) {
      const e = recentEvents[i]
      if (machineId && e.machineId !== machineId) continue
      let previous: MachineState | null = null
      for (let j = i - 1; j >= 0; j--) {
        if (recentEvents[j].machineId === e.machineId) {
          previous = recentEvents[j].state
          break
        }
      }
      out.push({ ...e, previous })
    }
    return out
  }, [recentEvents, limit, machineId])
}

// todays events for one machine (oldest first, with the state carried in from before midnight)
export function useTodayEvents(machineId: string): StateEvent[] {
  const { recentEvents } = useLiveSnapshot()
  return useMemo(() => recentEvents.filter((e) => e.machineId === machineId), [recentEvents, machineId])
}

export function useConnectionStatus(): connectionStatus {
  return useLiveSnapshot().status
}

// demo controls in mock mode, undefined against the real backend
export function useDemoControls(): demoControls | undefined {
  return useDataContext().ds.demo
}

// static layout for a machine id (positions, prototype flag)
export function useMachineLayout(id: string) {
  return GYM_LAYOUT.find((m) => m.id === id)
}

const HISTORY_REFRESH_MS = 5 * 60_000

// a machines raw event history for the last few days (plus the event before so we know the starting state)
// the detail page charts work out sessions and hourly profiles from it with src/lib, same as the backend would
export function useMachineHistory(id: string, days = 28): { events: StateEvent[] | undefined; loading: boolean } {
  const { ds } = useDataContext()
  const tick = useNow(HISTORY_REFRESH_MS)
  const snap = useLiveSnapshot()
  const { data, loading } = useFetch(snap.loaded ? `history:${id}:${days}#${tick.getTime()}` : null, () => {
    const to = tick
    const from = new Date(to.getTime() - (days + 1) * 86_400_000)
    return ds.getEvents(id, from, to)
  })
  // add live events that came in after the fetch so today stays up to date
  const events = useMemo(() => {
    if (!data) return undefined
    const last = data.length ? Date.parse(data[data.length - 1].timestamp) : 0
    const extra = snap.recentEvents.filter((e) => e.machineId === id && Date.parse(e.timestamp) > last)
    return extra.length ? [...data, ...extra] : data
  }, [data, snap.recentEvents, id])
  return { events, loading }
}

const HEALTH_REFRESH_MS = 15_000

// online flag and last heartbeat, polled (heartbeats arent pushed over the WebSocket)
export function useSensorHealth(id: string): Pick<Machine, "online" | "lastHeartbeat"> | undefined {
  const { ds } = useDataContext()
  const tick = useNow(HEALTH_REFRESH_MS)
  const live = useLiveSnapshot().machines.find((m) => m.id === id)
  const { data } = useFetch(`health:${id}#${tick.getTime()}`, () => ds.getMachine(id))
  if (!data) return live
  // the live store learns about online changes first
  return { online: live?.online ?? data.online, lastHeartbeat: data.lastHeartbeat }
}

const PLANNER_REFRESH_MS = 10 * 60_000

// everything the workout planner needs, by machine kind
// kind availability (pAnyFree / typicalFree), each units 4 week occupancy (to pick the quietest unit),
// average workout times and the whole gym heatmap
// history gets refetched when a unit goes in or out of maintenance or offline
// in the meantime unit availability comes from the live store so a unit that just broke is never offered, no reload
//   data: only changes when which units are in service changes (weekly plans)
//   live: also follows which units are free right now (todays live view)
// NOTE: against the API this is one heatmap request per machine
// a bulk endpoint (for example GET /api/heatmaps?weeks=4) would be kinder to the backend
export function usePlannerData(): {
  data: plannerData | undefined
  live: plannerData | undefined
  avgWorkout: Map<string, number>
  loading: boolean
} {
  const { ds } = useDataContext()
  const snap = useLiveSnapshot()
  const tick = useNow(PLANNER_REFRESH_MS)
  const machines = snap.machines
  const outKey = machines
    .filter((m) => !countsForLiveStats(m))
    .map((m) => m.id)
    .join(",")
  const freeKey = machines
    .filter(isFreeNow)
    .map((m) => m.id)
    .join(",")
  // after the '#', refetches keep showing the old data instead of flashing "loading"
  const { data: raw, loading } = useFetch(snap.loaded ? `planner#${outKey}:${tick.getTime()}` : null, async () => {
    const [gym, availability, heatmaps, stats] = await Promise.all([
      ds.getHeatmap("ALL", 4),
      ds.getKindAvailability(4),
      Promise.all(machines.map((m) => ds.getHeatmap(m.id, 4))),
      Promise.all(machines.map((m) => ds.getMachineStats(m.id))),
    ])
    return {
      gymOccupancy: gym.values,
      availability,
      unitOccupancy: new Map(heatmaps.map((h, i) => [machines[i].id, h.values])),
      avgWorkout: new Map(stats.map((s) => [s.machineId, s.avgWorkoutSeconds])),
    }
  })
  // weekly plans only depend on which units are in service, the today view also on which are free now
  const data = useMemo(() => {
    if (!raw) return undefined
    const available = new Set(machines.map((m) => m.id).filter((id) => !outKey.split(",").includes(id)))
    return { gymOccupancy: raw.gymOccupancy, kinds: buildPlannerKinds({ ...raw, live: { available, freeNow: new Set() } }) }
    // machines only gives the id list which never changes, availability comes from outKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, outKey])
  const live = useMemo(() => {
    if (!data) return undefined
    const free = new Set(freeKey.split(","))
    return { ...data, kinds: data.kinds.map((k) => ({ ...k, units: k.units.map((u) => ({ ...u, freeNow: u.available && free.has(u.id) })) })) }
  }, [data, freeKey])
  return { data, live, avgWorkout: raw?.avgWorkout ?? EMPTY_MAP, loading }
}

const EMPTY_MAP = new Map<string, number>()

// admin session, token + login/logout (see the security note in src/data/adminSession.ts)
export function useAdminSession() {
  const { ds } = useDataContext()
  const session = useSyncExternalStore(adminSession.subscribe, adminSession.get)
  return {
    session,
    isMock: ds.kind === "mock",
    async login(username: string, password: string) {
      const { token } = await ds.adminLogin(username, password)
      adminSession.set({ token, username })
    },
    logout: () => adminSession.set(null),
  }
}

// runs an admin call with the session token, an AuthError logs the admin out
function useAdminCall() {
  const session = useSyncExternalStore(adminSession.subscribe, adminSession.get)
  return async <T>(fn: (token: string) => Promise<T>) => {
    if (!session) throw new AuthError("Please log in again")
    try {
      return await fn(session.token)
    } catch (e) {
      if (e instanceof AuthError) adminSession.set(null)
      throw e
    }
  }
}

// admin maintenance actions, the live store picks the change up from the WebSocket message
export function useMaintenanceActions() {
  const { ds } = useDataContext()
  const wrap = useAdminCall()
  return {
    set: (id: string, m: Maintenance) => wrap((t) => ds.setMaintenance(id, m, t)),
    clear: (id: string) => wrap((t) => ds.clearMaintenance(id, t)),
  }
}

const ADMIN_REFRESH_MS = 2 * 60_000

// raw data for the owner dashboard, every machines stats and 4 weeks of events
export function useAdminData() {
  const { ds } = useDataContext()
  const snap = useLiveSnapshot()
  const tick = useNow(ADMIN_REFRESH_MS)
  const maintKey = snap.machines.map((m) => (m.maintenance ? `${m.id}${m.maintenance.since}` : "")).join("")
  const machines = snap.machines
  return useFetch(snap.loaded ? `admin:${maintKey}#${tick.getTime()}` : null, async () => {
    const to = tick
    const from = new Date(to.getTime() - 29 * 86_400_000)
    const [stats, events, heatmap, fresh] = await Promise.all([
      Promise.all(machines.map((m) => ds.getMachineStats(m.id))),
      ds.getEvents("ALL", from, to),
      ds.getHeatmap("ALL", 4),
      ds.getMachines(),
    ])
    return { stats, events, heatmap, machines: fresh, at: to.getTime() }
  })
}

// every nodes online flag and last heartbeat, polled every 15 s
export function useAllSensorHealth(): Machine[] | undefined {
  const { ds } = useDataContext()
  const tick = useNow(HEALTH_REFRESH_MS)
  const live = useLiveSnapshot().machines
  const { data } = useFetch(`health:ALL#${tick.getTime()}`, () => ds.getMachines())
  return useMemo(() => {
    if (!data) return undefined
    const online = new Map(live.map((m) => [m.id, m.online]))
    return data.map((m) => ({ ...m, online: online.get(m.id) ?? m.online }))
  }, [data, live])
}

// admin state overrides plus the audit log (refetched after each change and on live override messages)
export function useMachineControl() {
  const { ds } = useDataContext()
  const wrap = useAdminCall()
  const session = useSyncExternalStore(adminSession.subscribe, adminSession.get)
  const snap = useLiveSnapshot()
  const overrideKey = snap.machines.map((m) => (m.override ? `${m.id}${m.override.at}` : "")).join("")
  const [nonce, setNonce] = useState(0)
  const { data: log, error } = useFetch(session ? `overrides#${overrideKey}:${nonce}` : null, () => ds.getOverrides(session!.token))
  function after<T>(p: Promise<T>) {
    return p.finally(() => setNonce((n) => n + 1))
  }
  return {
    log,
    error,
    set: (id: string, state: MachineState, mode: overrideMode) => after(wrap((t) => ds.setOverride(id, state, mode, t))),
    release: (id: string) => after(wrap((t) => ds.releaseOverride(id, t))),
  }
}

const ZONES_REFRESH_MS = 60_000

// cleaning load per zone (refreshed every minute and after "mark cleaned")
export function useZones() {
  const { ds } = useDataContext()
  const wrap = useAdminCall()
  const session = useSyncExternalStore(adminSession.subscribe, adminSession.get)
  const tick = useNow(ZONES_REFRESH_MS)
  const [nonce, setNonce] = useState(0)
  const { data: zones, error } = useFetch(session ? `zones#${tick.getTime()}:${nonce}` : null, () => ds.getZones(session!.token))
  return {
    zones,
    error,
    markCleaned: (zoneId: string) => wrap((t) => ds.markZoneCleaned(zoneId, t)).finally(() => setNonce((n) => n + 1)),
  }
}

const DISMISSED_KEY = "gym-monitor.admin.dismissed-notifications"
// dismissed notification ids in localStorage + listeners so every bell stays in sync
const dismissedStore = (() => {
  const raw = readJSON<unknown>(DISMISSED_KEY, [])
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []
  let snapshot = new Set(ids)
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    add(next: string[]) {
      snapshot = new Set([...snapshot, ...next])
      // keep the list from growing forever, old incident ids never come back anyway
      writeJSON(DISMISSED_KEY, [...snapshot].slice(-300))
      for (const l of listeners) l()
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
})()

// admin notifications, cleaning alerts, machines due for service, offline nodes and long holds
// dismissed ids are remembered in localStorage
export function useNotifications(admin?: { events: StateEvent[]; stats: MachineStats[] }) {
  const { machines } = useLiveSnapshot()
  const { zones } = useZones()
  const now = useNow(30_000)
  const dismissed = useSyncExternalStore(dismissedStore.subscribe, dismissedStore.get)
  const all = useMemo(
    () =>
      buildNotifications({
        now: now.getTime(),
        zones,
        zoneNames: ZONE_NAMES,
        machines,
        events: admin?.events,
        maintenance: admin ? new Map(admin.stats.map((s) => [s.machineId, s.maintenanceHistory])) : undefined,
      }),
    [now, zones, machines, admin],
  )
  const unread = all.filter((n) => !dismissed.has(n.id))
  return {
    all,
    unread,
    dismiss: (id: string) => dismissedStore.add([id]),
    dismissAll: () => dismissedStore.add(unread.map((n) => n.id)),
  }
}

const ZONE_NAMES = new Map(FLOOR_ZONES.map((z) => [z.id, z.label.split(" · ")[0]]))
