// CALENDAR EXPORT
// Purpose: turns a weekly plan into an .ics file people can add to their calendar

import { DAY_LABELS, BLOCKS, addDays, mondayIndex, startOfDay } from "../time"
import type { Plan } from "./weekly"
import type { plannerKind } from "./types"

// 2 digit number for the date stamps
function pad(n: number) {
  return String(n).padStart(2, "0")
}

// local time with no zone, thats what iCalendar expects when theres no TZID
function icsLocal(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
}

// UTC stamp for DTSTAMP
function icsUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")
}

// escapes the characters iCalendar treats as special
function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n")
}

// next date on or after from that lands on weekday day (0 = Monday)
export function nextWeekday(from: Date, day: number): Date {
  const base = startOfDay(from)
  return addDays(base, (day - mondayIndex(base) + 7) % 7)
}

// the plan as an iCalendar file
// one weekly repeating event per workout, starting at its block and lasting the estimated workout time
export function planToICS(plan: Plan, machines: readonly plannerKind[], now = new Date()): string {
  const names = new Map(machines.map((m) => [m.id, m.name]))
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gym Monitor//Workout planner//EN", "CALSCALE:GREGORIAN"]
  if (plan.calendar) {
    // a drifting rest pattern doesnt repeat weekly, so one event per planned day instead
    const byWorkout = new Map(plan.workouts.map((w) => [w.workoutIndex, w]))
    for (const day of plan.calendar) {
      const w = day.workoutIndex === null ? undefined : byWorkout.get(day.workoutIndex)
      if (!w || !day.slot) continue
      const date = new Date(day.date)
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), BLOCKS[day.slot.block].startHour)
      const end = new Date(start.getTime() + Math.max(30 * 60, w.durationSeconds) * 1000)
      lines.push(
        "BEGIN:VEVENT",
        `UID:${plan.strategy}-${w.workoutIndex}-${start.getTime()}@gym-monitor`,
        `DTSTAMP:${icsUtc(now)}`,
        `DTSTART:${icsLocal(start)}`,
        `DTEND:${icsLocal(end)}`,
        `SUMMARY:${escape(`Gym: ${w.name}`)}`,
        `DESCRIPTION:${escape(`Rest-pattern plan (${plan.cycle?.days ?? "?"}-day cycle).`)}`,
        "END:VEVENT",
      )
    }
    lines.push("END:VCALENDAR")
    return lines.join("\r\n") + "\r\n"
  }
  for (const w of plan.workouts) {
    const date = nextWeekday(now, w.slot.day)
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), BLOCKS[w.slot.block].startHour)
    const end = new Date(start.getTime() + Math.max(30 * 60, w.durationSeconds) * 1000)
    // kinds only, a repeating event outlives any one unit so people check the planner on the day
    const order = w.order.map((id, i) => `${i + 1}. ${names.get(id) ?? id}`).join("\n")
    lines.push(
      "BEGIN:VEVENT",
      `UID:${plan.strategy}-${w.workoutIndex}-${DAY_LABELS[w.slot.day]}-${start.getTime()}@gym-monitor`,
      `DTSTAMP:${icsUtc(now)}`,
      `DTSTART:${icsLocal(start)}`,
      `DTEND:${icsLocal(end)}`,
      "RRULE:FREQ=WEEKLY",
      `SUMMARY:${escape(`Gym: ${w.name}`)}`,
      `DESCRIPTION:${escape(`${w.explanation}.\nSuggested order:\n${order}\nOpen Plan Your Workout on the day to see which machine to use.`)}`,
      "END:VEVENT",
    )
  }
  lines.push("END:VCALENDAR")
  return lines.join("\r\n") + "\r\n"
}
