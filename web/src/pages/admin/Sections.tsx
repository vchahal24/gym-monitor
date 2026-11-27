// ADMIN SECTION PAGES
// Purpose: the simple admin pages, overview, popularity, investments, peak hours, sessions, maintenance, sensors and exports

import { ArrowRight, Download } from "lucide-react"
import { liveCounts, reportingLine } from "../../lib/eligibility"
import { Link } from "react-router"
import { MaintenanceManager } from "../../components/admin/MaintenanceManager"
import { PopularitySection } from "../../components/admin/Popularity"
import { PeakHoursSection, RecommendationsSection, SaturationSection, SensorHealthSection, SessionInsightsSection } from "../../components/admin/Sections"
import { Card } from "../../components/Card"
import { useMachineControl, useNotifications, useZones } from "../../hooks"
import { toCSV } from "../../lib/admin"
import { formatBlock, formatDay, formatPercent } from "../../lib/format"
import { downloadText } from "../../lib/storage"
import { localDateKey } from "../../lib/time"
import { useAdmin } from "./context"
import { ADMIN_SECTIONS } from "./nav"
import { NotificationList } from "./NotificationList"

function Loading({ label = "Crunching four weeks of data" }: { label?: string }) {
  return <div className="h-80 animate-pulse rounded-xl bg-white/70 ring-1 ring-black/5" aria-busy="true" aria-label={label} />
}

export function OverviewPage() {
  const { view, machines, raw } = useAdmin()
  const notes = useNotifications(raw)
  const live = liveCounts(machines)
  const held = machines.filter((m) => m.override?.mode === "hold").length
  const offline = machines.filter((m) => !m.online).length
  const avgUtil = view ? view.rows.reduce((s, r) => s + r.utilisation, 0) / Math.max(1, view.rows.length) : null
  const thisWeek = view?.trend.at(-1)
  const stats: { label: string; value: string; sub: string; to: string }[] = [
    { label: "In use now", value: `${live.inUse} / ${live.reporting}`, sub: reportingLine(live), to: "/" },
    { label: "4-week utilisation", value: avgUtil === null ? "…" : formatPercent(avgUtil), sub: "average machine, 7 am – 9 pm", to: "/admin/popularity" },
    {
      label: "Busiest block",
      value: view ? `${formatDay(view.heatmap.busiest.day)} ${formatBlock(view.heatmap.busiest.block)}` : "…",
      sub: view ? `${formatPercent(view.heatmap.busiest.value)} of machines in use` : "",
      to: "/admin/peak-hours",
    },
    { label: "This week so far", value: thisWeek ? formatPercent(thisWeek.utilisation) : "…", sub: "gym-wide utilisation", to: "/admin/peak-hours" },
    {
      label: "Sensor nodes",
      value: `${machines.length - offline} / ${machines.length}`,
      sub: offline ? `${offline} offline` : "all online",
      to: "/admin/sensors",
    },
    { label: "Held by staff", value: String(held), sub: held ? "manual state pinned" : "none", to: "/admin/machine-control" },
  ]
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {stats.map((s) => (
          <li key={s.label}>
            <Link
              to={s.to}
              className="block h-full rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-black/5 hover:ring-forest focus-visible:outline-2 focus-visible:outline-forest"
            >
              <p className="text-xs font-semibold tracking-wide text-stone-600 uppercase">{s.label}</p>
              <p className="font-display text-3xl leading-tight text-forest sm:text-4xl">{s.value}</p>
              <p className="text-xs text-stone-600">{s.sub}</p>
            </Link>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Latest notifications" headingID="ov-notes">
          <NotificationList items={notes.unread} onDismiss={notes.dismiss} empty="All caught up: nothing needs attention." limit={6} />
        </Card>
        <Card title="Sections" headingID="ov-sections">
          <ul className="divide-y divide-stone-100">
            {ADMIN_SECTIONS.slice(1).map((s) => (
              <li key={s.path}>
                <Link to={`/admin/${s.path}`} className="group flex items-center gap-3 py-2.5 focus-visible:outline-2 focus-visible:outline-forest">
                  <s.icon size={18} className="text-forest" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-stone-900">{s.label}</span>
                    <span className="block text-xs text-stone-600">{s.blurb}</span>
                  </span>
                  <ArrowRight size={16} className="text-stone-400 group-hover:text-forest" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}

export function PopularityPage() {
  const { view, exportPopularity } = useAdmin()
  return view ? <PopularitySection rows={view.rows} kinds={view.kinds} onExport={exportPopularity} /> : <Loading />
}

export function InvestmentsPage() {
  const { view, now, exportRecommendations } = useAdmin()
  if (!view) return <Loading />
  return (
    <>
      <RecommendationsSection recs={view.recs} onExport={exportRecommendations} />
      <SaturationSection groups={view.groups} kinds={view.kinds} now={now} />
    </>
  )
}

export function PeakHoursPage() {
  const { view, now } = useAdmin()
  return view ? <PeakHoursSection heatmap={view.heatmap} trend={view.trend} now={now} /> : <Loading />
}

export function SessionsPage() {
  const { view } = useAdmin()
  return view ? <SessionInsightsSection byGroup={view.byGroup} perDay={view.perDay} rests={view.rests} /> : <Loading />
}

export function MaintenancePage() {
  const { view, machines } = useAdmin()
  return view ? <MaintenanceManager machines={machines} rows={view.rows} /> : <Loading />
}

export function SensorsPage() {
  const { health, now } = useAdmin()
  return <SensorHealthSection machines={health} now={now} />
}

export function ExportsPage() {
  const { view, now, exportPopularity, exportRecommendations } = useAdmin()
  const { log } = useMachineControl()
  const { zones } = useZones()
  const stamp = localDateKey(now)
  const items: { title: string; detail: string; run?: () => void }[] = [
    {
      title: "Machine popularity",
      detail: "Rank, utilisation, sessions, average session and downtime per machine (4 weeks).",
      run: view ? exportPopularity : undefined,
    },
    {
      title: "Investment recommendations",
      detail: "What to buy, rethink or service, with the numbers behind it.",
      run: view ? exportRecommendations : undefined,
    },
    {
      title: "Manual override log",
      detail: "Every admin state change: machine, from, to, mode, who and when.",
      run: log
        ? () =>
            downloadText(
              `overrides-${stamp}.csv`,
              toCSV([["at", "machine", "from", "to", "mode", "by"], ...log.map((e) => [e.at, e.machineId, e.from, e.to, e.mode, e.by])]),
              "text/csv",
            )
        : undefined,
    },
    {
      title: "Zone cleaning load",
      detail: "Sessions and occupied minutes since each zone was last cleaned.",
      run: zones
        ? () =>
            downloadText(
              `zones-${stamp}.csv`,
              toCSV([
                ["zone", "last_cleaned", "sessions_since", "occupied_min_since"],
                ...zones.map((z) => [z.zoneId, z.lastCleaned, z.sessionsSince, z.occupiedMinutesSince]),
              ]),
              "text/csv",
            )
        : undefined,
    },
  ]
  return (
    <Card title="CSV exports" headingID="exports-title">
      <ul className="divide-y divide-stone-100">
        {items.map((i) => (
          <li key={i.title} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold text-stone-900">{i.title}</p>
              <p className="text-sm text-stone-600">{i.detail}</p>
            </div>
            {i.run ? (
              <button
                type="button"
                onClick={i.run}
                className="inline-flex items-center gap-1.5 rounded-lg bg-forest px-3 py-1.5 text-sm font-semibold text-cream hover:bg-forest-mid focus-visible:outline-2 focus-visible:outline-mustard"
              >
                <Download size={15} aria-hidden /> Download CSV
              </button>
            ) : (
              <span className="text-sm text-stone-500">Loading…</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
