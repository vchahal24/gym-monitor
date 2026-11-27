// FORMATTING
// Purpose: turns numbers and dates into the text the UI shows

// timer text, for example "4:05", "12:30", "1:02:03"
export function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

// rough length, for example "45 s", "12 min", "1 h 5 min"
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h} h ${rm} min` : `${h} h`
}

// contract block label to display label with an en dash, "5-7 pm" -> "5–7 pm"
export function formatBlock(label: string): string {
  return label.replace("-", "–")
}

// "MON" -> "Mon"
export function formatDay(day: string): string {
  return day.charAt(0) + day.slice(1).toLowerCase()
}

// 0.71 -> "71%"
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

// time of day with seconds
export function formatClock(iso: string | number | Date): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
}

// how long ago, for example "just now", "12 min ago"
export function formatRelative(iso: string, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000))
  if (s < 5) return "just now"
  if (s < 60) return `${s} s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return `${h} h ago`
}

// for example "Mon 16 Nov"
export function formatDate(iso: string | number | Date): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })
}

// for example "Mon 16 Nov, 9:30 am"
export function formatDateTime(iso: string | number | Date): string {
  return new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

// 1 -> "1st", 22 -> "22nd"
export function ordinal(n: number): string {
  const v = n % 100
  const suffix = v >= 11 && v <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")
  return `${n}${suffix}`
}

// the header clock, for example "Mon 23 Nov 2026 · 9:04 pm" in local time
export function formatClockLine(d: Date): string {
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short" })
  const month = d.toLocaleDateString("en-GB", { month: "short" })
  const h = d.getHours() % 12 || 12
  const ampm = d.getHours() < 12 ? "am" : "pm"
  return `${weekday} ${d.getDate()} ${month} ${d.getFullYear()} · ${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`
}
