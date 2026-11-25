// TODAY PLANNER
// Purpose: ranks the blocks left today (or tomorrow and the days after) for the picked machines

import { addDays, blockRange, mondayIndex, startOfDay } from "../time"
import { slotScore } from "./score"
import type { plannerData, plannerKind, slotScoreType } from "./types"

export interface datedSlot extends slotScoreType {
  start: number // epoch ms
  end: number // end of its last block, epoch ms
  current: boolean // now is inside it, aka the "Now until 9 pm" one
  remainingMs: number // ms left for the current slot, otherwise its whole length
}

// slots on date that havent ended by after, one thats in progress still counts
function slotsForDate(machines: readonly plannerKind[], data: plannerData, date: Date, blocks: number, after: number): datedSlot[] {
  const day = mondayIndex(date)
  const out: datedSlot[] = []
  for (let b = 0; b + blocks <= 7; b++) {
    const [bs] = blockRange(date, b)
    const [, be] = blockRange(date, b + blocks - 1)
    if (be <= after) continue
    const s = slotScore(machines, data, day, b, blocks)
    const current = bs <= after
    if (s) out.push({ ...s, start: bs, end: be, current, remainingMs: be - Math.max(bs, after) })
  }
  return out
}

// blocks today that havent ended yet (including the one in progress), best first
export function rankBlocksToday(machines: readonly plannerKind[], data: plannerData, now: Date, blocks = 1): datedSlot[] {
  return slotsForDate(machines, data, now, blocks, now.getTime()).sort((a, b) => b.score - a.score || a.start - b.start)
}

// every block tomorrow, best first
export function rankBlocksTomorrow(machines: readonly plannerKind[], data: plannerData, now: Date, blocks = 1): datedSlot[] {
  const date = addDays(startOfDay(now), 1)
  return slotsForDate(machines, data, date, blocks, date.getTime()).sort((a, b) => b.score - a.score || a.start - b.start)
}

export interface todayOutlookType {
  today: datedSlot[] // blocks left today, best first
  nothingLeft: boolean // for example after 9 pm, so show tomorrow and the week instead
  tomorrow: datedSlot[] // only filled when nothing is left today
  laterDays: datedSlot[] // the best slot on each of the following days
}

// what the Today tab shows
// when theres no block left today, tomorrows best blocks and the rest of the week take its place
export function todayOutlook(machines: readonly plannerKind[], data: plannerData, now: Date, blocks = 1): todayOutlookType {
  const today = rankBlocksToday(machines, data, now, blocks)
  const nothingLeft = today.length === 0
  const tomorrow = nothingLeft ? rankBlocksTomorrow(machines, data, now, blocks).slice(0, 3) : []
  // tomorrow has its own list in that case, so the rest of the week starts the day after
  const laterDays = bestAlternativeDays(machines, data, now, blocks, 3, nothingLeft ? 2 : 1)
  return { today, nothingLeft, tomorrow, laterDays }
}

// best slot on each of the next 6 days starting firstDay days ahead, best first
export function bestAlternativeDays(machines: readonly plannerKind[], data: plannerData, now: Date, blocks = 1, count = 3, firstDay = 1): datedSlot[] {
  const out: datedSlot[] = []
  for (let i = firstDay; i <= 6; i++) {
    const date = addDays(startOfDay(now), i)
    const best = slotsForDate(machines, data, date, blocks, date.getTime()).sort((a, b) => b.score - a.score)[0]
    if (best) out.push(best)
  }
  return out.sort((a, b) => b.score - a.score || a.start - b.start).slice(0, count)
}
