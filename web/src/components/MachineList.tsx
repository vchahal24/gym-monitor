// MACHINE LIST
// Purpose: the plain list of machines, the text version of the floor map

import { Link } from "react-router"
import { formatDate, formatDuration } from "../lib/format"
import { displayStatus } from "../lib/machine"
import type { Machine } from "../types"
import { MachineTile } from "./MachineTile"
import { RestingCountdown } from "./RestingCountdown"
import { StateBadge } from "./StateBadge"

// compact list of machines, the text version of the floor map and the main view on phones
export function MachineList({ machines, now }: { machines: Machine[]; now: Date }) {
  if (machines.length === 0) return <p className="text-sm text-stone-600">No machines match these filters.</p>
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
      {machines.map((m) => (
        <li key={m.id}>
          <Link
            to={`/machine/${m.id}`}
            className="flex items-center gap-3 rounded-lg bg-white px-2.5 py-2 shadow-sm ring-1 ring-black/5 hover:ring-forest/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
          >
            <MachineTile machine={m} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-stone-900">
                <span className="text-forest">{m.id}</span> {m.name}
                {m.prototype && <span className="sr-only"> (live sensor)</span>}
              </span>
              <span className="block truncate text-xs text-stone-500">
                {m.maintenance
                  ? `Since ${formatDate(m.maintenance.since)}${m.maintenance.expectedBack ? ` · back ${formatDate(m.maintenance.expectedBack)}` : ""}`
                  : m.online
                    ? `for ${formatDuration((now.getTime() - Date.parse(m.since)) / 1000)}`
                    : "No data from sensor"}
                {m.online && !m.maintenance && <RestingCountdown machine={m} now={now} short className="ml-1 before:content-['·_']" />}
              </span>
            </span>
            <StateBadge state={displayStatus(m)} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
