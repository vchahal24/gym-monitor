// RESTING COUNTDOWN
// Purpose: the "Free in ≤ 3:42 if no movement" countdown for a RESTING machine

import { formatTimer } from "../lib/format"
import { restingCountdownSeconds } from "../lib/remaining"
import type { Machine } from "../types"

// worked out from since, so it resets live as soon as the machine goes ACTIVE and back
export function RestingCountdown({
  machine,
  now,
  short = false,
  className = "",
}: {
  machine: Pick<Machine, "state" | "since"> & { override?: Machine["override"] }
  now: Date
  short?: boolean
  className?: string
}) {
  const left = restingCountdownSeconds(machine, now)
  if (left === null) return null
  const t = formatTimer(left)
  return (
    <span className={`tabular-nums ${className}`} title="The sensor frees the machine after 5 minutes without movement">
      {short ? `free in ≤ ${t}` : `Free in ≤ ${t} if no movement`}
    </span>
  )
}
