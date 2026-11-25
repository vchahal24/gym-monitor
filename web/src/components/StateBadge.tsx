// STATE BADGE
// Purpose: the status pill

import type { DisplayStatus } from "../types"
import { StateIcon } from "./StateIcon"
import { MAINTENANCE_HATCH, STATE_META } from "./stateMeta"

// pass it the display status (see displayStatus)
// OFFLINE gets a dashed outline and a signal off icon, MAINTENANCE gets hatching and a wrench
export function StateBadge({ state, size = "sm", label }: { state: DisplayStatus; size?: "sm" | "md"; label?: string }) {
  const pad = size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs"
  const meta = STATE_META[state]
  const offline = state === "OFFLINE"
  return (
    <span
      className={`state-fade inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap ${pad} ${offline ? "border border-dashed border-current" : ""}`}
      style={{
        backgroundColor: meta.tint,
        backgroundImage: state === "MAINTENANCE" ? MAINTENANCE_HATCH : undefined,
        color: meta.text,
      }}
    >
      <StateIcon state={state} size={size === "md" ? 14 : 12} />
      {label ?? (offline ? meta.description : meta.label)}
    </span>
  )
}
