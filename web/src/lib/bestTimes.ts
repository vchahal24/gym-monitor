// QUIETEST TIMES AHEAD
// Purpose: picks the quietest blocks left this week for the best times card on the machine page

import type { Heatmap } from "../types"
import { BLOCKS, addDays, blockRange, mondayIndex, startOfDay } from "./time"

export interface upcomingBlock {
  day: number // 0 = Monday
  block: number
  value: number // expected occupancy 0..1 from the heatmap
  start: number // epoch ms
  nextWeek: boolean // this week ran out of blocks so its from next week
}

// the n quietest blocks still ahead this week, by expected occupancy
// the current block only counts if 30+ min of it are left
// if theres fewer than n left we carry on into next week
export function quietestUpcomingBlocks(heatmap: Pick<Heatmap, "values">, now: Date, n = 3): upcomingBlock[] {
  const t = now.getTime()
  const out: upcomingBlock[] = []
  const today = startOfDay(now)
  const weekEnd = addDays(today, 7 - mondayIndex(now)).getTime()
  function collect(fromDay: number, toDay: number) {
    const list: upcomingBlock[] = []
    for (let i = fromDay; i < toDay; i++) {
      const date = addDays(today, i)
      for (let b = 0; b < BLOCKS.length; b++) {
        const [bs, be] = blockRange(date, b)
        if (be - Math.max(bs, t) < 30 * 60_000) continue
        const day = mondayIndex(date)
        list.push({ day, block: b, value: heatmap.values[day][b], start: bs, nextWeek: bs >= weekEnd })
      }
    }
    return list.sort((a, b) => a.value - b.value || a.start - b.start)
  }
  const daysLeft = 7 - mondayIndex(now)
  out.push(...collect(0, daysLeft).slice(0, n))
  if (out.length < n) out.push(...collect(daysLeft, daysLeft + 7).slice(0, n - out.length))
  return out
}
