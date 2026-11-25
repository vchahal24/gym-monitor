// POPULARITY
// Purpose: the admin popularity table and chart, by unit or by kind

import { ArrowDown, ArrowUp, Download } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { GROUP_LABELS, kindPlural } from "../../config/gym-layout"
import type { kindRow, popularityRow } from "../../lib/admin"
import { formatDuration, formatPercent } from "../../lib/format"
import { Card } from "../Card"

type sortKey = "utilisation" | "sessions" | "avgWorkoutSeconds" | "downtimeHours" | "name"

const HIGHLIGHT = 3
const BAR = "#1E7A4C"
const BAR_TOP = "#0B4A2E"
const BAR_LOW = "#C27A12"

// machine popularity, by unit or by kind
export function PopularitySection({ rows, kinds, onExport }: { rows: popularityRow[]; kinds: kindRow[]; onExport: () => void }) {
  const [view, setView] = useState<"unit" | "kind">("unit")
  const toggle = (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Show popularity" className="inline-flex rounded-full bg-white/15 p-0.5 text-xs font-semibold">
        {(["unit", "kind"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`rounded-full px-2.5 py-1 ${view === v ? "bg-cream text-forest" : "text-cream hover:bg-white/10"}`}
          >
            {v === "unit" ? "By machine" : "By kind"}
          </button>
        ))}
      </div>
      <ExportButton onClick={onExport} label="CSV" />
    </div>
  )
  return view === "unit" ? <ByUnit rows={rows} action={toggle} /> : <ByKind kinds={kinds} action={toggle} />
}

// one row per kind, for example "Treadmills: 4 units, 64% average, all 4 busy during 22% of weekday 5–7 pm"
function ByKind({ kinds, action }: { kinds: kindRow[]; action: React.ReactNode }) {
  const sorted = [...kinds].sort((a, b) => b.utilisation - a.utilisation)
  return (
    <Card title="Machine popularity" headingID="pop-title" action={action}>
      <ul className="divide-y divide-stone-100 text-sm">
        {sorted.map((k) => (
          <li key={k.kind} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
            <span className="min-w-0 flex-1">
              <strong className="text-stone-900">{kindPlural(k.kind)}</strong>
              <span className="text-stone-700">
                : {k.units.length} unit{k.units.length === 1 ? "" : "s"}, {formatPercent(k.utilisation)} average
                {k.units.length > 1 && (
                  <>
                    , all {k.units.length} busy during {formatPercent(k.weekdayEvening)} of weekday 5–7 pm
                  </>
                )}
              </span>
              <span className="block text-xs text-stone-500">
                {k.units.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link to={`/machine/${id}`} className="hover:underline">
                      {id}
                    </Link>
                  </span>
                ))}{" "}
                · {k.sessions} sessions in 4 weeks
              </span>
            </span>
            <span className="h-2.5 w-32 overflow-hidden rounded-full bg-heat-0" aria-hidden>
              <span className="block h-full rounded-full bg-forest-mid" style={{ width: formatPercent(k.utilisation) }} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// every machine ranked by 4 week utilisation and sessions, sortable table + bar chart
function ByUnit({ rows, action }: { rows: popularityRow[]; action: React.ReactNode }) {
  const [sort, setSort] = useState<{ key: sortKey; desc: boolean }>({ key: "utilisation", desc: true })
  const byUtil = [...rows].sort((a, b) => b.utilisation - a.utilisation)
  const top = new Set(byUtil.slice(0, HIGHLIGHT).map((r) => r.id))
  const low = new Set(byUtil.slice(-HIGHLIGHT).map((r) => r.id))
  const sorted = [...rows].sort((a, b) => {
    const v = sort.key === "name" ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key]
    return sort.desc ? -v : v
  })

  function header(key: sortKey, label: string, align = "text-right") {
    return (
      <th scope="col" className={`px-2 py-2 ${align}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
          className="inline-flex items-center gap-1 font-semibold hover:text-forest focus-visible:outline-2 focus-visible:outline-forest"
        >
          {label}
          {sort.key === key && (sort.desc ? <ArrowDown size={13} aria-hidden /> : <ArrowUp size={13} aria-hidden />)}
        </button>
      </th>
    )
  }

  return (
    <Card title="Machine popularity" headingID="pop-title" action={action} bodyClassName="p-0">
      <div className="grid gap-0 xl:grid-cols-2">
        <div className="overflow-x-auto p-3 sm:p-4">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Machines ranked by utilisation over the last 4 weeks. Column headers sort the table.</caption>
            <thead className="border-b border-stone-200 text-xs text-stone-600">
              <tr>
                <th scope="col" className="px-2 py-2 text-left">
                  #
                </th>
                {header("name", "Machine", "text-left")}
                {header("utilisation", "Utilisation")}
                {header("sessions", "Sessions")}
                {header("avgWorkoutSeconds", "Avg session")}
                {header("downtimeHours", "Downtime")}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sorted.map((r) => (
                <tr key={r.id} className={top.has(r.id) ? "bg-[#E2F4E6]/60" : low.has(r.id) ? "bg-[#FCF3D2]/60" : undefined}>
                  <td className="px-2 py-1.5 tabular-nums text-stone-500">{byUtil.indexOf(r) + 1}</td>
                  <td className="px-2 py-1.5">
                    <Link to={`/machine/${r.id}`} className="font-semibold text-stone-900 hover:underline">
                      {r.id} {r.name}
                    </Link>
                    <span className="block text-xs text-stone-500">
                      {GROUP_LABELS[r.group]}
                      {top.has(r.id) && <strong className="ml-1.5 text-[#1B7234]">· Most used</strong>}
                      {low.has(r.id) && <strong className="ml-1.5 text-[#7A5A00]">· Least used</strong>}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatPercent(r.utilisation)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.sessions}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatDuration(r.avgWorkoutSeconds)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.downtimeHours >= 0.5 ? `${Math.round(r.downtimeHours)} h` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-stone-100 p-3 sm:p-4 xl:border-t-0 xl:border-l">
          <p className="mb-2 text-sm text-stone-600">4-week utilisation (share of opening hours occupied, maintenance excluded)</p>
          <div style={{ height: byUtil.length * 22 + 30 }}>
            <ResponsiveContainer>
              <BarChart
                data={byUtil.map((r) => ({ name: `${r.id} ${r.name}`, id: r.id, v: r.utilisation }))}
                layout="vertical"
                margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                barCategoryGap={2}
              >
                <CartesianGrid stroke="#E7E2D8" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 1]}
                  tickFormatter={(v: number) => formatPercent(v)}
                  tick={{ fontSize: 11, fill: "#57534e" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: "#44403c" }} axisLine={false} tickLine={false} interval={0} />
                <Tooltip
                  formatter={(v) => [formatPercent(Number(v)), "Utilisation"]}
                  cursor={{ fill: "rgb(0 0 0 / 0.04)" }}
                  contentStyle={{ borderRadius: 8, fontSize: 13 }}
                />
                <Bar dataKey="v" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {byUtil.map((r) => (
                    <Cell key={r.id} fill={top.has(r.id) ? BAR_TOP : low.has(r.id) ? BAR_LOW : BAR} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 flex flex-wrap gap-4 text-xs text-stone-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm" style={{ background: BAR_TOP }} /> Top {HIGHLIGHT}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm" style={{ background: BAR_LOW }} /> Bottom {HIGHLIGHT}
            </span>
          </p>
        </div>
      </div>
    </Card>
  )
}

// the CSV download button
export function ExportButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md bg-cream/15 px-2.5 py-1 text-sm font-semibold text-cream hover:bg-cream/25 focus-visible:outline-2 focus-visible:outline-mustard"
    >
      <Download size={15} aria-hidden /> {label}
    </button>
  )
}
