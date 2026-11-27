// MACHINE PANEL
// Purpose: the side panel that opens when you pick a machine on the floor map

import { useEffect, useRef } from "react"
import { Link } from "react-router"
import { GROUP_LABELS } from "../config/gym-layout"
import { useMachine } from "../hooks"
import { formatDuration, formatTimer } from "../lib/format"
import { currentSessionSeconds, estimateRemainingSeconds } from "../lib/remaining"
import { LiveStatus } from "./LiveStatus"
import { MachineTile } from "./MachineTile"

// side panel for the machine selected on the floor map
export function MachinePanel({ id, now, onClose }: { id: string; now: Date; onClose: () => void }) {
  const { machine, stats } = useMachine(id)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [id])

  if (!machine) return null
  const frozen = !!machine.maintenance
  const session = frozen ? null : currentSessionSeconds(machine, now)
  const remaining = stats && !frozen ? estimateRemainingSeconds(machine, stats.avgWorkoutSeconds, now) : null

  return (
    <section
      className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5"
      aria-labelledby="panel-title"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="flex items-center gap-3">
          <MachineTile machine={machine} size={48} />
          <div>
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
              {machine.id} · {GROUP_LABELS[machine.group]}
              {machine.prototype && <span className="ml-2 rounded-full bg-forest px-2 py-0.5 text-[10px] text-cream">LIVE SENSOR</span>}
            </p>
            <h2 id="panel-title" ref={heading} tabIndex={-1} className="font-display text-3xl text-brown outline-none">
              {machine.name}
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 rounded-full p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-2 focus-visible:outline-forest"
          aria-label="Close machine panel"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mx-4 mt-3">
        <LiveStatus machine={machine} now={now} />
      </div>

      <dl className="grid grid-cols-2 gap-3 px-4 py-3 text-sm">
        <div>
          <dt className="text-xs text-stone-500">Current session</dt>
          <dd className="font-semibold tabular-nums text-stone-900">{session === null ? "—" : formatTimer(session)}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Est. time remaining</dt>
          <dd className="font-semibold tabular-nums text-stone-900">
            {remaining === null ? "—" : remaining === 0 ? "Any moment" : `~${formatDuration(remaining)}`}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-stone-500">Average session length</dt>
          <dd className="font-semibold text-stone-900">{stats ? formatDuration(stats.avgWorkoutSeconds) : "…"}</dd>
        </div>
      </dl>

      <div className="border-t border-stone-100 px-4 py-3">
        <Link
          to={`/machine/${machine.id}`}
          className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-forest px-4 py-2 font-semibold text-cream hover:bg-forest-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mustard"
        >
          View machine details <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  )
}
