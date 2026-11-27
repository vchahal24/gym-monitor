// STATE INTERVALS
// Purpose: turns the event stream into spans of time in each state, most stats start from here

import type { MachineState, StateEvent } from "../types"

// time a machine spent in one state, epoch ms
export interface stateInterval {
  machineId: string
  state: MachineState
  start: number
  end: number
}

// in use = ACTIVE or RESTING, the one definition the whole project uses
export function isInUse(state: MachineState): boolean {
  return state === "ACTIVE" || state === "RESTING"
}

// groups events by machine, each list sorted by time
export function groupByMachine(events: readonly StateEvent[]): Map<string, StateEvent[]> {
  const out = new Map<string, StateEvent[]>()
  for (const e of events) {
    let list = out.get(e.machineId)
    if (!list) out.set(e.machineId, (list = []))
    list.push(e)
  }
  for (const list of out.values()) {
    if (!isSorted(list)) list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  }
  return out
}

// event stream -> back to back state intervals, clipped to [from, until]
// events before from still set the starting state
// before a machines first event we dont know its state, so theres no interval for that bit
// repeated events with the same state get merged
export function eventsToIntervals(events: readonly StateEvent[], until: number, from = Number.NEGATIVE_INFINITY): stateInterval[] {
  const out: stateInterval[] = []
  for (const [machineId, list] of groupByMachine(events)) {
    let cur: { state: MachineState; start: number } | null = null
    function push(end: number) {
      if (!cur) return
      const s = Math.max(cur.start, from)
      const e = Math.min(end, until)
      if (e > s) out.push({ machineId, state: cur.state, start: s, end: e })
    }
    for (const ev of list) {
      const t = Date.parse(ev.timestamp)
      if (t > until) break
      if (cur && cur.state === ev.state) continue
      push(t)
      cur = { state: ev.state, start: t }
    }
    push(until)
  }
  return out
}

// the log is nearly always in order already, so only sort when it isnt
function isSorted(list: readonly StateEvent[]): boolean {
  for (let i = 1; i < list.length; i++) {
    if (Date.parse(list[i - 1].timestamp) > Date.parse(list[i].timestamp)) return false
  }
  return true
}
