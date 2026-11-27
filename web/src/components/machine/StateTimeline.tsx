// STATE TIMELINE
// Purpose: todays states for one machine as a strip, with closed hours shaded

import { CLOSE_HOUR, OPEN_HOUR, hourLabel } from "../../config/gym-hours"
import { formatClock, formatDuration } from "../../lib/format"
import { eventsToIntervals } from "../../lib/intervals"
import type { downtimeWindow } from "../../lib/maintenance"
import { startOfDay } from "../../lib/time"
import type { StateEvent } from "../../types"
import { MAINTENANCE_HATCH, OFFLINE_META, STATE_META } from "../stateMeta"

// one hour either side of opening hours so you can see the closed shading
const FROM_H = OPEN_HOUR - 1
const TO_H = CLOSE_HOUR + 1
const CLOSED_BG = "repeating-linear-gradient(135deg, #E4E0DA 0 6px, #D6D1C9 6px 12px)"

const NO_DATA_BG = "repeating-linear-gradient(135deg, #ECEAE6 0 4px, #D6D1C9 4px 7px)"

// todays states as a strip around opening hours (5 am - midnight), closed hours shaded grey
// realSensor shows the whole day and draws states in closed hours too, a real node is never hidden by opening hours
export function StateTimeline({
  events,
  now,
  downtime,
  realSensor = false,
}: {
  events: readonly StateEvent[]
  now: Date
  downtime: readonly downtimeWindow[]
  realSensor?: boolean
}) {
  const day = startOfDay(now)
  const fromH = realSensor ? 0 : FROM_H
  const toH = realSensor ? 24 : TO_H
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), fromH).getTime()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), toH).getTime()
  const t = Math.min(now.getTime(), end)
  const span = end - start
  function pct(ms: number) {
    return `${(ms / span) * 100}%`
  }

  const open = new Date(day.getFullYear(), day.getMonth(), day.getDate(), OPEN_HOUR).getTime()
  const close = new Date(day.getFullYear(), day.getMonth(), day.getDate(), CLOSE_HOUR).getTime()
  // only open hours count for simulated machines, the closed parts are just drawn as shading
  let segments = t > open ? eventsToIntervals(withPriorState(events), Math.min(t, close), open) : []
  if (realSensor) segments = eventsToIntervals(withPriorState(events), t, start)
  const windows = downtime
    .map((w) => ({ start: Math.max(w.start, start), end: Math.min(w.end, t), offline: w.reason === "offline" }))
    .filter((w) => w.end > w.start)
  const maint = windows.filter((w) => !w.offline)
  const noData = windows.filter((w) => w.offline)
  const totals = { AVAILABLE: 0, ACTIVE: 0, RESTING: 0 }
  for (const s of segments) totals[s.state] += s.end - s.start

  const hours = []
  for (let h = realSensor ? 0 : OPEN_HOUR; h < toH; h += 3) hours.push(h)

  return (
    <div>
      <div
        className="relative h-10 overflow-hidden rounded-md bg-stone-100 ring-1 ring-black/5"
        role="img"
        aria-label={`Today so far: active ${formatDuration(totals.ACTIVE / 1000)}, resting ${formatDuration(totals.RESTING / 1000)}, available ${formatDuration(totals.AVAILABLE / 1000)}`}
      >
        <div className="absolute inset-y-0" style={{ left: 0, width: pct(open - start), backgroundImage: CLOSED_BG }} title="Closed" />
        <div className="absolute inset-y-0" style={{ left: pct(close - start), right: 0, backgroundImage: CLOSED_BG }} title="Closed" />
        {noData.map((w) => (
          <div
            key={`off-${w.start}`}
            className="absolute inset-y-0"
            style={{ left: pct(w.start - start), width: pct(w.end - w.start), backgroundImage: NO_DATA_BG }}
            title={OFFLINE_META.description}
          />
        ))}
        {segments.map((s) => (
          <div
            key={`${s.start}-${s.state}`}
            className="absolute inset-y-0"
            style={{ left: pct(s.start - start), width: pct(s.end - s.start), backgroundColor: STATE_META[s.state].color }}
            title={`${STATE_META[s.state].label} ${formatClock(s.start)} – ${formatClock(s.end)}`}
          />
        ))}
        {maint.map((w) => (
          <div
            key={`maint-${w.start}`}
            className="absolute inset-y-0"
            style={{
              left: pct(w.start - start),
              width: pct(w.end - w.start),
              backgroundColor: STATE_META.MAINTENANCE.color,
              backgroundImage: MAINTENANCE_HATCH,
            }}
            title="In maintenance"
          />
        ))}
        {now.getTime() < end && <div className="absolute inset-y-0 border-l-2 border-stone-800" style={{ left: pct(t - start) }} title="Now" />}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-stone-500" aria-hidden="true">
        {hours.map((h) => (
          <span key={h} className="absolute -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: pct((h - fromH) * 3_600_000) }}>
            {hourLabel(h)}
          </span>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-stone-700">
        {(["ACTIVE", "RESTING", "AVAILABLE"] as const).map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm" style={{ backgroundColor: STATE_META[s].color }} aria-hidden="true" />
            {STATE_META[s].label} <span className="font-semibold tabular-nums">{formatDuration(totals[s] / 1000)}</span>
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ backgroundImage: CLOSED_BG }} aria-hidden="true" />
          Closed
        </li>
        {noData.length > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm" style={{ backgroundImage: NO_DATA_BG }} aria-hidden="true" />
            No data
          </li>
        )}
        {maint.length > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-3 rounded-sm"
              style={{ backgroundColor: STATE_META.MAINTENANCE.color, backgroundImage: MAINTENANCE_HATCH }}
              aria-hidden="true"
            />
            Maintenance
          </li>
        )}
      </ul>
    </div>
  )
}

// the store only has events from a bit before midnight so a machines first event might be its first of the day
// a session start (ACTIVE) means it was AVAILABLE before, so the strip can start at opening time
function withPriorState(events: readonly StateEvent[]): StateEvent[] {
  const first = events[0]
  if (!first || first.state !== "ACTIVE") return [...events]
  return [{ ...first, state: "AVAILABLE", timestamp: new Date(0).toISOString() }, ...events]
}
