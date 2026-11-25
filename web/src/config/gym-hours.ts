// GYM HOURS
// Purpose: opening hours (docs/DATA_CONTRACT.md §0) and helpers for open / closed
// the gym is open 6 am - 11 pm every day, the heatmaps and utilisation still cover the 7 am - 9 pm blocks
// (see BLOCKS in src/lib/time.ts), all times are the users local time

export const OPEN_HOUR = 6 // 0-23 (6 = 6 am)
export const CLOSE_HOUR = 23 // 1-24 (23 = 11 pm)

const HOUR_MS = 3_600_000

// that day (plus dayOffset) at the given hour
function at(d: Date, hour: number, dayOffset = 0): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, hour)
}

// opening and closing time on the same calendar day as d
export function openingWindow(d: Date): { open: number; close: number } {
  return { open: at(d, OPEN_HOUR).getTime(), close: at(d, CLOSE_HOUR).getTime() }
}

// true while the gym is open
export function isOpenAt(d: Date | number): boolean {
  const date = typeof d === "number" ? new Date(d) : d
  const { open, close } = openingWindow(date)
  const t = date.getTime()
  return t >= open && t < close
}

// the next opening after d, or that days own opening if d is before it
export function nextOpening(d: Date | number): Date {
  const date = typeof d === "number" ? new Date(d) : d
  const { open } = openingWindow(date)
  return date.getTime() < open ? new Date(open) : at(date, OPEN_HOUR, 1)
}

// closing time on the day d is in (only makes sense while open)
export function closingTime(d: Date | number): Date {
  const date = typeof d === "number" ? new Date(d) : d
  return new Date(openingWindow(date).close)
}

// "6 am", "11 pm", "12 pm"
export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24
  if (hh === 0) return "12 am"
  if (hh === 12) return "12 pm"
  if (hh > 12) return `${hh - 12} pm`
  return `${hh} am`
}

// the open status line, "Open until 11 pm" or "Gym closed, opens 6 am" (+ "tomorrow" when its needed)
export function openStatus(now: Date): { open: boolean; text: string } {
  if (isOpenAt(now)) return { open: true, text: `Open until ${hourLabel(CLOSE_HOUR)}` }
  const next = nextOpening(now)
  // after midnight "opens 6 am" already means today, late in the evening its tomorrow
  const sameDay = next.getDate() === now.getDate()
  return { open: false, text: `Gym closed, opens ${hourLabel(OPEN_HOUR)}${sameDay ? "" : " tomorrow"}` }
}

// number of open hours per day
export const OPEN_HOURS_PER_DAY = CLOSE_HOUR - OPEN_HOUR
export const OPEN_MS_PER_DAY = OPEN_HOURS_PER_DAY * HOUR_MS
