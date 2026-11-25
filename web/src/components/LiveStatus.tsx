// LIVE STATUS
// Purpose: the big live status block for a machine, how long, countdown or maintenance details

import { Lock } from "lucide-react"
import { formatDate, formatDuration } from "../lib/format"
import { displayStatus } from "../lib/machine"
import type { Machine } from "../types"
import { RestingCountdown } from "./RestingCountdown"
import { StateIcon } from "./StateIcon"
import { MAINTENANCE_HATCH, STATE_META } from "./stateMeta"

// big live status, the label, how long, the RESTING countdown or maintenance details
// a machine in maintenance is frozen so it shows no timer or countdown
export function LiveStatus({ machine, now, size = "md" }: { machine: Machine; now: Date; size?: "md" | "lg" }) {
  const status = displayStatus(machine)
  const maint = machine.maintenance
  const offline = status === "OFFLINE"
  const meta = STATE_META[status]
  const big = size === "lg"

  return (
    <div
      className={`state-fade flex items-start gap-3 rounded-lg ${big ? "px-4 py-3" : "px-3 py-2.5"} ${offline ? "border-2 border-dashed border-[#8C847A]" : ""}`}
      style={{ backgroundColor: meta.tint, backgroundImage: maint ? MAINTENANCE_HATCH : undefined }}
      role="status"
      aria-live="polite"
    >
      <span
        className={`state-fade mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full ${big ? "size-12" : "size-9"}`}
        style={{ backgroundColor: meta.color, color: meta.onColor }}
      >
        <StateIcon state={status} size={big ? 24 : 18} />
      </span>
      <div className="min-w-0">
        <p className={`font-display leading-none ${big ? "text-5xl" : "text-3xl"}`} style={{ color: meta.text }}>
          {maint ? "Out of service" : offline ? "No data from sensor" : meta.label}
        </p>
        {maint ? (
          <div className={`mt-1 text-stone-800 ${big ? "text-base" : "text-sm"}`}>
            <p>
              Out of service since <strong>{formatDate(maint.since)}</strong>
            </p>
            <p>{maint.reason}</p>
            <p>
              Expected back: <strong>{maint.expectedBack ? formatDate(maint.expectedBack) : "not known yet"}</strong>
            </p>
          </div>
        ) : (
          <>
            <p className={`mt-1 text-stone-700 ${big ? "text-sm" : "text-xs"}`}>
              {offline
                ? "No packet or heartbeat from the sensor node for over 90 s, so its state is unknown. It isn’t counted in live availability, and the time is left out of its usage stats."
                : `for ${formatDuration((now.getTime() - Date.parse(machine.since)) / 1000)} · ${STATE_META[status].description}`}
            </p>
            {!offline && <RestingCountdown machine={machine} now={now} className={`block font-semibold text-stone-900 ${big ? "text-lg" : "text-sm"}`} />}
            {machine.override?.mode === "hold" && (
              <p className={`mt-1 inline-flex items-center gap-1 rounded-full bg-forest px-2 py-0.5 font-semibold text-cream ${big ? "text-sm" : "text-xs"}`}>
                <Lock size={big ? 14 : 12} aria-hidden /> Held by staff: this status is set manually for now
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
