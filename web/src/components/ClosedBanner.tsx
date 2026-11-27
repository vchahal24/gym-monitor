// CLOSED BANNER
// Purpose: the "Gym closed" message shown instead of zeros while the gym is closed

import { Moon } from "lucide-react"
import { openStatus } from "../config/gym-hours"

// shown instead of zeros that would mislead while the gym is closed, nothing when its open
export function ClosedBanner({ now, detail }: { now: Date; detail?: string }) {
  const status = openStatus(now)
  if (status.open) return null
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl bg-stone-700 px-4 py-3 text-stone-50 shadow-sm">
      <Moon size={22} aria-hidden className="shrink-0 text-mustard" />
      <p>
        <strong className="font-display text-2xl leading-none tracking-wide">{status.text}</strong>
        {detail && <span className="block text-sm text-stone-200">{detail}</span>}
      </p>
    </div>
  )
}
