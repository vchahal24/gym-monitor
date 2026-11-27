// DOWNTIME WINDOWS
// Purpose: turns maintenance (and offline) spells into time windows and cuts them out of usage

import type { maintenanceRecord } from "../types"

// a span in epoch ms when a machine was out of service
export interface downtimeWindow {
  machineId: string
  start: number
  end: number
  reason?: "maintenance" | "offline" // why its excluded, maintenance if not set
}

// maintenance records -> downtime windows
// a record thats still open (end is null) is cut off at now
export function downtimeWindows(machineId: string, records: readonly maintenanceRecord[], now: number): downtimeWindow[] {
  return records.map((r) => ({ machineId, start: Date.parse(r.since), end: r.end ? Date.parse(r.end) : now })).filter((w) => w.end > w.start)
}

// ms of downtime inside [from, to]
export function downtimeMs(windows: readonly downtimeWindow[], from: number, to: number): number {
  let tot = 0
  for (const w of windows) tot += Math.max(0, Math.min(w.end, to) - Math.max(w.start, from))
  return tot
}

// cuts the parts of each interval that fall in that machines downtime
// so maintenance and offline time never count towards usage
export function subtractDowntime<T extends { machineId: string; start: number; end: number }>(
  intervals: readonly T[],
  windows: readonly downtimeWindow[],
): T[] {
  if (windows.length === 0) return [...intervals]
  const byMachine = new Map<string, downtimeWindow[]>()
  for (const w of windows) {
    const list = byMachine.get(w.machineId) ?? []
    list.push(w)
    byMachine.set(w.machineId, list)
  }
  const out: T[] = []
  for (const iv of intervals) {
    let pieces: T[] = [iv]
    for (const w of byMachine.get(iv.machineId) ?? []) {
      const next: T[] = []
      for (const p of pieces) {
        if (w.end <= p.start || w.start >= p.end) {
          next.push(p)
          continue
        }
        if (w.start > p.start) next.push({ ...p, end: w.start })
        if (w.end < p.end) next.push({ ...p, start: w.end })
      }
      pieces = next
    }
    out.push(...pieces)
  }
  return out
}
