// PLANNER FORMATTING
// Purpose: day and time slot labels for the planner

import type { slotScoreType } from "../../lib/planner"
import { BLOCKS, DAY_LABELS } from "../../lib/time"

// 0 -> "Mon"
export function dayName(d: number): string {
  const l = DAY_LABELS[d]
  return l.charAt(0) + l.slice(1).toLowerCase()
}

// 17 -> "5 pm"
function hour(h: number) {
  if (h === 12) return "12 pm"
  if (h > 12) return `${h - 12} pm`
  return `${h} am`
}

// "7–9 am", or "5 pm–9 pm" for a long workout
export function slotTime(slot: Pick<slotScoreType, "block" | "blocks">): string {
  if (slot.blocks === 1) return BLOCKS[slot.block].label.replace("-", "–")
  return `${hour(BLOCKS[slot.block].startHour)}–${hour(BLOCKS[slot.block + slot.blocks - 1].endHour)}`
}
