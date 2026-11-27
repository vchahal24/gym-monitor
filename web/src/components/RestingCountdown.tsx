// RESTING COUNTDOWN
// Purpose: the "Free in ≤ 3:42 if no movement" countdown for a RESTING machine

import { formatDuration, formatTimer } from "../lib/format"
import { restingCountdownSeconds } from "../lib/remaining"
import { restingTimeoutSecondsFor } from "../lib/timing"
import type { Machine } from "../types"

// worked out from since, so it resets live as soon as the machine goes ACTIVE and back
export function RestingCountdown({
  machine,
  now,
  short = false,
  className = "",
}: {
  machine: Pick<Machine, "state" | "since"> & { override?: Machine["override"]; timing?: Machine["timing"] }
  now: Date
  short?: boolean
  className?: string
}) {
  const left = restingCountdownSeconds(machine, now)
  if (left === null) return null
  const t = formatTimer(left)
  return (
    <span className={`tabular-nums ${className}`} title={`The sensor frees the machine ${formatDuration(restingTimeoutSecondsFor(machine))} after the last movement`}>
      {short ? `free in ≤ ${t}` : `Free in ≤ ${t} if no movement`}
    </span>
  )
}
