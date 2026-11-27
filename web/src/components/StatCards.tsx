// STAT CARDS
// Purpose: the summary numbers at the top of the gym floor page

import { openStatus } from "../config/gym-hours"
import type { busiestTodayType } from "../hooks"
import { reportingLine } from "../lib/eligibility"
import { formatBlock, formatDuration, formatPercent } from "../lib/format"
import { AnimatedNumber } from "./AnimatedNumber"
import type { Summary } from "../types"

// one summary card
function Stat({
  label,
  value,
  detail,
  children,
  className = "",
}: {
  label: string
  value: React.ReactNode
  detail?: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex min-w-0 flex-col rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5 ${className}`}>
      <dt className="text-xs font-semibold tracking-wide text-stone-600 uppercase">{label}</dt>
      <dd className="mt-1 font-display text-4xl leading-none text-forest sm:text-5xl">{value}</dd>
      {detail && <dd className="mt-1.5 text-sm text-stone-600">{detail}</dd>}
      {children}
    </div>
  )
}

// the row of summary cards
export function StatCards({ summary, busiestToday, now }: { summary: Summary | undefined; busiestToday: busiestTodayType | null; now: Date }) {
  const status = openStatus(now)
  if (!summary) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-white/70 ring-1 ring-black/5" />
        ))}
      </div>
    )
  }
  const inUse = summary.active + summary.resting
  // while closed the live counts are all 0 and mean nothing, so say that instead
  const closed = !status.open && inUse === 0
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Stat
        label="Available now"
        value={
          closed ? (
            "Closed"
          ) : (
            <>
              <AnimatedNumber value={summary.available} /> / {summary.reporting}
            </>
          )
        }
        detail={closed ? status.text : `machines free · ${reportingLine(summary)}`}
      />
      <Stat
        label="Gym in use"
        value={closed ? "—" : <AnimatedNumber value={summary.utilisation} format={formatPercent} />}
        detail={closed ? "Gym closed" : `${inUse} of ${summary.reporting} reporting machine${summary.reporting === 1 ? "" : "s"} taken`}
      >
        <dd className="mt-2 h-2 overflow-hidden rounded-full bg-heat-0" aria-hidden="true">
          <div
            className="h-full rounded-full bg-forest-mid transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: closed ? 0 : formatPercent(summary.utilisation) }}
          />
        </dd>
      </Stat>
      <Stat
        label="Active sessions"
        value={closed ? "—" : <AnimatedNumber value={inUse} />}
        detail={closed ? "Gym closed" : `${summary.active} mid-set · ${summary.resting} resting`}
      />
      <Stat
        label="Avg session today"
        value={summary.sessionsToday ? <AnimatedNumber value={summary.avgWorkoutSecondsToday} format={formatDuration} /> : "—"}
        detail={`${summary.sessionsToday} sessions finished`}
      />
      <Stat
        className="col-span-2 md:col-span-1"
        label="Busiest today"
        value={busiestToday ? formatBlock(busiestToday.block) : "—"}
        detail={busiestToday ? `${formatPercent(busiestToday.value)} of machines in use` : "No activity yet"}
      />
    </dl>
  )
}
