// ACTIVITY FEED
// Purpose: the live list of recent state changes on the gym floor page

import { useState } from "react"
import { Link } from "react-router"
import type { feedItem } from "../hooks"
import { usePacedFeed } from "../hooks/usePacedFeed"
import { formatClock, formatRelative } from "../lib/format"
import type { Machine } from "../types"
import { StateIcon } from "./StateIcon"
import { STATE_META } from "./stateMeta"

// what the change means for people, "session started", "next set" etc.
function describe(e: feedItem): string {
  if (e.state === "ACTIVE") return e.previous === "RESTING" ? "next set" : "session started"
  if (e.state === "RESTING") return "resting"
  return "free again"
}

// live list of recent state changes, newest first
export function ActivityFeed({ events: incoming, machines, now }: { events: feedItem[]; machines: Machine[]; now: Date }) {
  // at most one new item a second so bursts slide in one at a time
  const events = usePacedFeed(incoming, keyOf)
  const names = new Map(machines.map((m) => [m.id, m.name]))
  // only highlight items that come in after the feed first showed up
  const [mountedAt] = useState(() => now.getTime())
  if (events.length === 0) return <p className="p-4 text-sm text-stone-600">No activity yet today.</p>
  return (
    <ol className="divide-y divide-stone-100" aria-label="Recent state changes, newest first">
      {events.map((e) => {
        const meta = STATE_META[e.state]
        return (
          <li key={keyOf(e)} className={Date.parse(e.timestamp) > mountedAt ? "feed-enter" : undefined}>
            <Link
              to={`/machine/${e.machineId}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-cream focus-visible:bg-cream focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-forest"
            >
              <span
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: meta.color, color: meta.onColor }}
                aria-hidden="true"
              >
                <StateIcon state={e.state} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  <span className="font-semibold text-stone-900">
                    {e.machineId} {names.get(e.machineId)}
                  </span>{" "}
                  <span className="text-stone-600">{describe(e)}</span>
                </span>
                <span className="block text-xs font-semibold" style={{ color: meta.text }}>
                  {meta.label}
                </span>
              </span>
              <time dateTime={e.timestamp} className="shrink-0 text-right text-xs text-stone-500 tabular-nums" title={formatClock(e.timestamp)}>
                {formatRelative(e.timestamp, now)}
              </time>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}

// unique per event
function keyOf(e: feedItem) {
  return `${e.machineId}-${e.timestamp}`
}
