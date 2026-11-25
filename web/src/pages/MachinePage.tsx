// MACHINE PAGE
// Purpose: the dashboard for one machine at /machine/:id

import { ArrowLeft, Clock, Radio, Timer, TrendingDown, TrendingUp } from "lucide-react"
import { useMemo } from "react"
import { Link, Navigate, useParams } from "react-router"
import { Card } from "../components/Card"
import { ClosedBanner } from "../components/ClosedBanner"
import { NotFoundPage } from "./NotFoundPage"
import { Heatmap } from "../components/Heatmap"
import { LiveStatus } from "../components/LiveStatus"
import { MachineTile } from "../components/MachineTile"
import { SessionLengthHistogram, SessionsPerDayChart, TodayVsTypicalChart } from "../components/machine/Charts"
import { StateTimeline } from "../components/machine/StateTimeline"
import { StateBadge } from "../components/StateBadge"
import { GROUP_LABELS, KIND_LABELS, LEGACY_IDS, kindPlural } from "../config/gym-layout"
import { STATE_META } from "../components/stateMeta"
import { openStatus } from "../config/gym-hours"
import { RESTING_TIMEOUT_SECONDS } from "../config/state-machine"
import { useHeatmap, useMachine, useMachineHistory, useMachines, useNow, useSensorHealth, useTodayEvents } from "../hooks"
import { alternativeHint, alternativesFor } from "../lib/alternatives"
import { quietestUpcomingBlocks } from "../lib/bestTimes"
import { formatBlock, formatDate, formatDateTime, formatDay, formatDuration, formatPercent, formatRelative, formatTimer, ordinal } from "../lib/format"
import { histogram } from "../lib/histogram"
import { hourlyOccupancy, typicalHourly } from "../lib/hourly"
import { displayStatus } from "../lib/machine"
import { historyExclusions } from "../lib/eligibility"
import { averageWorkoutSeconds, deriveSessions, median } from "../lib/sessions"
import { currentSessionSeconds, estimateRemainingSeconds, restingCountdownSeconds } from "../lib/remaining"
import { BLOCKS, DAY_LABELS, addDays, startOfDay } from "../lib/time"
import { inUseIntervals } from "../lib/utilisation"
import type { DisplayStatus, Machine, MachineStats } from "../types"

const HIST_STEPS = [60, 120, 180, 300, 600, 900]

// dashboard for one machine (Slide 7 but more), stacked on phones and a grid on big screens
export function MachinePage() {
  const { id = "" } = useParams()
  const now = useNow(1000)
  const { machine, stats, notFound } = useMachine(id)
  const { machines } = useMachines()
  const { heatmap } = useHeatmap(id)
  const { events: history } = useMachineHistory(id)
  const todayEvents = useTodayEvents(id)
  const health = useSensorHealth(id)

  const minute = Math.floor(now.getTime() / 60_000)
  // maintenance and offline time are left out of the charts (not counted as idle)
  const downtime = useMemo(
    () => (stats ? historyExclusions(id, stats.maintenanceHistory, stats.offlineHistory ?? [], (minute + 1) * 60_000) : []),
    [id, stats, minute],
  )

  // worked out from the raw event stream the same way the backend would
  const derived = useMemo(() => {
    if (!history) return null
    const t = minute * 60_000
    const nowD = new Date(t)
    const from = addDays(startOfDay(nowD), -28).getTime()
    const sessions = deriveSessions(history).filter((s) => Date.parse(s.start) >= from)
    const intervals = inUseIntervals(history, id, from, t, downtime)
    return {
      sessions,
      today: hourlyOccupancy(intervals, downtime, nowD, t),
      typical: typicalHourly(intervals, downtime, nowD),
    }
  }, [history, id, downtime, minute])

  // old links (/machine/M02) go to the renamed machine
  if (notFound && LEGACY_IDS[id.toUpperCase()]) return <Navigate to={`/machine/${LEGACY_IDS[id.toUpperCase()]}`} replace />
  if (notFound) return <NotFoundPage />
  if (!machine) {
    return <div className="h-96 animate-pulse rounded-xl bg-white/70 ring-1 ring-black/5" aria-busy="true" aria-label="Loading machine" />
  }

  const weekday = now.toLocaleDateString([], { weekday: "long" })
  const workouts = derived?.sessions.map((s) => s.workoutSeconds) ?? []

  return (
    <div className="space-y-5">
      <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-forest-mid hover:text-forest hover:underline">
        <ArrowLeft size={16} aria-hidden /> Gym floor
      </Link>

      <ClosedBanner now={now} detail="Nobody is using machines right now. Today's charts show the hours the gym was open." />

      <Header machine={machine} machines={machines} stats={stats} now={now} health={health} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Usage rates" headingID="usage-title">
          <UsageRates machine={machine} stats={stats} total={machines.length} now={now} />
        </Card>

        <Card title="Weekly heatmap" headingID="heat-title" className="lg:col-span-2">
          {heatmap && heatmap.busiest.value > 0 && (
            <p className="mb-3 text-sm text-stone-700">
              Busiest:{" "}
              <strong>
                {formatDay(heatmap.busiest.day)} {formatBlock(heatmap.busiest.block)}
              </strong>
              , {formatPercent(heatmap.busiest.value)} of the block in use.
            </p>
          )}
          <Heatmap heatmap={heatmap} now={now} markBusiest caption={`Share of each block ${machine.name} was in use, averaged over 4 weeks`} />
        </Card>

        <Card title={`Today vs a typical ${weekday}`} headingID="today-title" className="lg:col-span-2">
          {derived ? <TodayVsTypicalChart today={derived.today} typical={derived.typical} weekday={weekday} /> : <ChartSkeleton />}
          <p className="mt-1 text-xs text-stone-500">Share of each hour the machine was occupied (in use or within the 5-minute rest timeout).</p>
        </Card>

        <Card title="Best times to use" headingID="best-title">
          {machine.maintenance && <p className="mb-3 text-sm text-[#A04A06]">Out of service right now; these are for when it's back.</p>}
          {heatmap ? <BestTimes values={heatmap.values} now={now} /> : <ChartSkeleton short />}
        </Card>

        <Card title="Today's timeline" headingID="timeline-title" className="lg:col-span-3">
          <StateTimeline events={todayEvents} now={now} downtime={downtime} />
        </Card>

        <Card title="Sessions per day" headingID="spd-title" className="lg:col-span-2">
          {stats ? <SessionsPerDayChart data={stats.sessionsPerDay} /> : <ChartSkeleton />}
          {stats && (
            <p className="mt-1 text-sm text-stone-600">
              {stats.sessionsPerDay.reduce((s, d) => s + d.count, 0)} sessions in the last 4 weeks,{" "}
              {(stats.sessionsPerDay.reduce((s, d) => s + d.count, 0) / stats.sessionsPerDay.length).toFixed(1)} a day on average.
            </p>
          )}
        </Card>

        <Card title="Alternatives" headingID="alt-title">
          <Alternatives machine={machine} machines={machines} />
        </Card>

        <Card title="Session length" headingID="len-title" className="lg:col-span-2">
          {derived ? (
            workouts.length ? (
              <>
                <SessionLengthHistogram bins={histogram(workouts, HIST_STEPS, 12)} mean={averageWorkoutSeconds(derived.sessions)} median={median(workouts)} />
                <p className="mt-1 text-sm text-stone-600">
                  Average <strong>{formatDuration(averageWorkoutSeconds(derived.sessions))}</strong>, median <strong>{formatDuration(median(workouts))}</strong>{" "}
                  over {workouts.length} sessions. Session length runs from the first rep to the end of the last set; the machine stays marked as taken for{" "}
                  {RESTING_TIMEOUT_SECONDS / 60} more minutes.
                </p>
              </>
            ) : (
              <p className="text-sm text-stone-600">No completed sessions in the last 4 weeks.</p>
            )
          ) : (
            <ChartSkeleton />
          )}
        </Card>

        <Card title="Maintenance history" headingID="maint-title">
          <MaintenanceHistory stats={stats} now={now} />
        </Card>
      </div>
    </div>
  )
}

const SIBLING_WORD: Record<DisplayStatus, string> = {
  AVAILABLE: "free",
  ACTIVE: "active",
  RESTING: "resting",
  MAINTENANCE: "maintenance",
  OFFLINE: "no data",
}

// "Other treadmills: TM01 (maintenance), TM03 (free), TM04 (active)", each a link
function Siblings({ machine, machines }: { machine: Machine; machines: Machine[] }) {
  const others = machines.filter((m) => m.kind === machine.kind && m.id !== machine.id)
  if (others.length === 0) return null
  return (
    <p className="mt-2 text-sm text-stone-700">
      <span className="font-semibold">Other {kindPlural(machine.kind).toLowerCase()}:</span>{" "}
      {others.map((m, i) => {
        const st = displayStatus(m)
        return (
          <span key={m.id}>
            {i > 0 && ", "}
            <Link to={`/machine/${m.id}`} className="font-semibold text-forest underline decoration-forest/30 underline-offset-2 hover:decoration-forest">
              {m.id}
            </Link>{" "}
            <span style={{ color: STATE_META[st].text }}>({SIBLING_WORD[st]})</span>
          </span>
        )
      })}
    </p>
  )
}

function Header({
  machine,
  machines,
  stats,
  now,
  health,
}: {
  machine: Machine
  machines: Machine[]
  stats: MachineStats | undefined
  now: Date
  health: Pick<Machine, "online" | "lastHeartbeat"> | undefined
}) {
  // in maintenance or no data from the sensor, so no live timers
  const frozen = !!machine.maintenance || !machine.online
  const session = frozen ? null : currentSessionSeconds(machine, now)
  const remaining = stats && !frozen ? estimateRemainingSeconds(machine, stats.avgWorkoutSeconds, now) : null
  const countdown = frozen ? null : restingCountdownSeconds(machine, now)
  const online = health?.online ?? machine.online

  return (
    <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5" aria-labelledby="machine-title">
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex items-center gap-4">
          <MachineTile machine={machine} size={88} />
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-wide text-stone-500 uppercase">
              {machine.id} · {GROUP_LABELS[machine.group]} · {KIND_LABELS[machine.kind]}
            </p>
            <h1 id="machine-title" className="font-display text-4xl leading-none text-brown sm:text-5xl">
              {machine.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {machine.prototype && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-forest px-2.5 py-1 text-xs font-bold tracking-wide text-cream">
                  <Radio size={13} aria-hidden /> LIVE SENSOR · prototype node
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${online ? "bg-[#E2F4E6] text-[#1B7234]" : "bg-stone-200 text-stone-700"}`}
              >
                <span className={`size-2 rounded-full ${online ? "bg-available" : "bg-stone-500"}`} aria-hidden />
                Sensor {online ? "online" : "offline"}
                {health?.lastHeartbeat && <> · heartbeat {formatRelative(health.lastHeartbeat, now)}</>}
              </span>
            </div>
            <Siblings machine={machine} machines={machines} />
          </div>
        </div>

        <LiveStatus machine={machine} now={now} size="lg" />

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Fact icon={<Timer size={16} />} label="Current session" value={session === null ? "—" : formatTimer(session)} />
          <Fact
            icon={<Clock size={16} />}
            label="Est. time until free"
            value={
              frozen
                ? machine.maintenance
                  ? "Out of service"
                  : "No data"
                : machine.state === "AVAILABLE"
                  ? "Free now"
                  : remaining === null
                    ? "…"
                    : `~${formatDuration(remaining + RESTING_TIMEOUT_SECONDS)}`
            }
            detail={
              !frozen && machine.state !== "AVAILABLE" && remaining !== null
                ? `${remaining === 0 ? "Workout running long" : `~${formatDuration(remaining)} of workout left`}, then the 5-min timeout${
                    countdown !== null ? ` (at most ${formatTimer(countdown)} if they've left)` : ""
                  }`
                : undefined
            }
          />
          <Fact label="Average session" value={stats ? formatDuration(stats.avgWorkoutSeconds) : "…"} />
          <Fact label="Median session" value={stats ? formatDuration(stats.medianWorkoutSeconds) : "…"} />
        </dl>
      </div>
    </section>
  )
}

function Fact({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-cream px-3 py-2">
      <dt className="flex items-center gap-1 text-xs font-semibold text-stone-600" aria-hidden={false}>
        {icon && <span aria-hidden>{icon}</span>}
        {label}
      </dt>
      <dd className="mt-0.5 font-display text-2xl leading-none text-forest tabular-nums">{value}</dd>
      {detail && <dd className="mt-1 text-xs text-stone-600">{detail}</dd>}
    </div>
  )
}

function UsageRates({ machine, stats, total, now }: { machine: Machine; stats: MachineStats | undefined; total: number; now: Date }) {
  // utilisation covers the 7 am - 9 pm blocks, before 7 am theres nothing to measure today yet
  const notStarted = now.getHours() < BLOCKS[0].startHour
  if (!stats) return <ChartSkeleton short />
  const u = stats.utilisation
  const diff = u.fourWeeks - stats.groupAvgUtilisation
  const rows: [string, number][] = [
    ["Today", u.today],
    ["This week", u.week],
    ["Last 4 weeks", u.fourWeeks],
  ]
  return (
    <div className="space-y-4">
      <dl className="space-y-3">
        {rows.map(([label, v]) => (
          <div key={label}>
            <div className="flex items-baseline justify-between">
              <dt className="text-sm text-stone-700">{label}</dt>
              <dd className="font-display text-3xl leading-none text-forest tabular-nums">
                {label === "Today" && machine.maintenance ? (
                  <span className="text-xl text-[#A04A06]">In maintenance</span>
                ) : label === "Today" && notStarted ? (
                  <span className="text-xl text-stone-500">{openStatus(now).open ? "Starts 7 am" : openStatus(now).text}</span>
                ) : (
                  formatPercent(v)
                )}
              </dd>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-heat-0" aria-hidden>
              <div className="h-full rounded-full bg-forest-mid" style={{ width: formatPercent(v) }} />
            </div>
          </div>
        ))}
      </dl>
      <div className="rounded-lg bg-cream px-3 py-2.5 text-sm text-stone-800">
        <p>
          <strong className="font-display text-2xl text-brown">{ordinal(stats.rank)}</strong> busiest of {total} machines
        </p>
        <p className="mt-1 flex items-center gap-1.5">
          {diff >= 0 ? <TrendingUp size={16} className="text-active" aria-hidden /> : <TrendingDown size={16} className="text-forest-mid" aria-hidden />}
          {Math.abs(Math.round(diff * 100))} pts {diff >= 0 ? "above" : "below"} the {GROUP_LABELS[machine.group]} average (
          {formatPercent(stats.groupAvgUtilisation)})
        </p>
      </div>
      <p className="text-xs text-stone-500">Share of opening hours (7 am – 9 pm) the machine was occupied. Time in maintenance is left out.</p>
    </div>
  )
}

function BestTimes({ values, now }: { values: number[][]; now: Date }) {
  const best = quietestUpcomingBlocks({ values }, now, 3)
  if (best.length === 0) return <p className="text-sm text-stone-600">No blocks left to suggest.</p>
  return (
    <div>
      <ol className="space-y-2">
        {best.map((b, i) => (
          <li key={`${b.day}-${b.block}-${b.nextWeek}`} className="flex items-center gap-3 rounded-lg bg-cream px-3 py-2">
            <span className="font-display text-3xl leading-none text-mustard">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-stone-900">
                {b.nextWeek ? "Next " : ""}
                {formatDay(DAY_LABELS[b.day])} {formatBlock(BLOCKS[b.block].label)}
              </span>
              <span className="block text-xs text-stone-600">{formatDate(b.start)}</span>
            </span>
            <span className="text-right">
              <span className="block font-display text-2xl leading-none text-forest">{formatPercent(1 - b.value)}</span>
              <span className="block text-[11px] text-stone-500">free</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-stone-500">The quietest blocks left this week, from the 4-week average.</p>
    </div>
  )
}

function Alternatives({ machine, machines }: { machine: Machine; machines: Machine[] }) {
  const alts = alternativesFor(machine, machines)
  const hint = alternativeHint(machine, alts)
  if (alts.length === 0) return <p className="text-sm text-stone-600">No other {GROUP_LABELS[machine.group]} machines are in service.</p>
  return (
    <div>
      {hint && <p className="mb-3 rounded-lg bg-[#E2F4E6] px-3 py-2 text-sm font-semibold text-[#1B7234]">{hint}</p>}
      <ul className="space-y-1.5">
        {alts.slice(0, 6).map(({ machine: m, sameKind }) => (
          <li key={m.id}>
            <Link
              to={`/machine/${m.id}`}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-cream focus-visible:outline-2 focus-visible:outline-forest"
            >
              <MachineTile machine={m} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-stone-900">{m.name}</span>
                <span className="block text-xs text-stone-500">{sameKind ? "Same machine type" : KIND_LABELS[m.kind]}</span>
              </span>
              <StateBadge state={displayStatus(m)} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MaintenanceHistory({ stats, now }: { stats: MachineStats | undefined; now: Date }) {
  if (!stats) return <ChartSkeleton short />
  const list = stats.maintenanceHistory
  if (list.length === 0) return <p className="text-sm text-stone-600">No maintenance recorded.</p>
  return (
    <ol className="space-y-3">
      {list.map((r) => {
        const end = r.end ? Date.parse(r.end) : now.getTime()
        return (
          <li key={r.since} className="border-l-4 pl-3" style={{ borderColor: r.end ? "#D6CFC4" : "#F07B1F" }}>
            <p className="text-sm font-semibold text-stone-900">{r.reason}</p>
            <p className="text-xs text-stone-600">
              {formatDateTime(r.since)} → {r.end ? formatDateTime(r.end) : <strong className="text-[#A04A06]">ongoing</strong>}
              {" · "}
              {formatDuration((end - Date.parse(r.since)) / 1000)}
            </p>
            {!r.end && r.expectedBack && <p className="text-xs text-stone-600">Expected back {formatDate(r.expectedBack)}</p>}
          </li>
        )
      })}
    </ol>
  )
}

function ChartSkeleton({ short = false }: { short?: boolean }) {
  return <div className={`${short ? "h-40" : "h-56"} w-full animate-pulse rounded-lg bg-stone-100`} aria-busy="true" />
}
