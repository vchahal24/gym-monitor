// HEADER CLOCK
// Purpose: the real time clock and open / closed status in the header

import { useEffect, useState } from "react"
import { openStatus } from "../config/gym-hours"
import { formatClockLine } from "../lib/format"

// wall clock time in the header (always real time, even when the demo speeds the simulation up)
// plus whether the gym is open
export function HeaderClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // tick on the second so the minute changes on time
    let t: ReturnType<typeof setTimeout>
    function tick() {
      setNow(new Date())
      t = setTimeout(tick, 1000 - (Date.now() % 1000))
    }
    t = setTimeout(tick, 1000 - (Date.now() % 1000))
    return () => clearTimeout(t)
  }, [])
  const status = openStatus(now)
  return (
    <div className="text-right leading-tight">
      <time dateTime={now.toISOString()} className="block text-xs font-semibold whitespace-nowrap tabular-nums text-cream sm:text-sm" aria-live="off">
        {formatClockLine(now)}
      </time>
      <span className={`mt-0.5 inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${status.open ? "text-[#BFE8C9]" : "text-cream/75"}`}>
        <span className={`size-2 rounded-full ${status.open ? "bg-available" : "bg-stone-400"}`} aria-hidden="true" />
        {status.open ? status.text : status.text.replace("Gym closed", "Closed")}
      </span>
    </div>
  )
}
