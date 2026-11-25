// CALENDAR HELPERS
// Purpose: days, weeks and the 2 hour blocks, all in the users local time zone
// weeks start on Monday

export const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const

export interface blockType {
  label: string // contract format, for example "5-7 pm"
  startHour: number
  endHour: number
}

// the seven 2 hour blocks on every heatmap, 7 am to 9 pm
export const BLOCKS: blockType[] = [
  { label: "7-9 am", startHour: 7, endHour: 9 },
  { label: "9-11 am", startHour: 9, endHour: 11 },
  { label: "11 am-1 pm", startHour: 11, endHour: 13 },
  { label: "1-3 pm", startHour: 13, endHour: 15 },
  { label: "3-5 pm", startHour: 15, endHour: 17 },
  { label: "5-7 pm", startHour: 17, endHour: 19 },
  { label: "7-9 pm", startHour: 19, endHour: 21 },
]

export const MS_PER_SECOND = 1000
export const MS_PER_MINUTE = 60_000
export const MS_PER_HOUR = 3_600_000

// 0 = Monday ... 6 = Sunday
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

// which block d is in, -1 if its outside 7 am - 9 pm
export function blockIndexAt(d: Date): number {
  const h = d.getHours()
  return BLOCKS.findIndex((b) => h >= b.startHour && h < b.endHour)
}

// midnight at the start of d
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// adds calendar days and keeps the wall clock time, so DST changes dont shift it
export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())
}

// midnight on the Monday of ds week
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -mondayIndex(d))
}

// local date as YYYY-MM-DD
export function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// start and end in ms of block blockIdx on that calendar day
export function blockRange(day: Date, blockIdx: number): [number, number] {
  const b = BLOCKS[blockIdx]
  const y = day.getFullYear()
  const m = day.getMonth()
  const dd = day.getDate()
  return [new Date(y, m, dd, b.startHour).getTime(), new Date(y, m, dd, b.endHour).getTime()]
}

// ms that [aStart, aEnd] and [bStart, bEnd] share
export function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}
