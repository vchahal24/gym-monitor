// ADMIN SECTIONS
// Purpose: the chart heavy admin sections, recommendations, saturation, peak hours, sessions and sensors

import { CircleSlash, ShoppingCart, Wrench } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { GROUP_LABELS, GROUP_STYLE, kindPlural } from "../../config/gym-layout"
import type { kindRow, recommendation, restInsightsType } from "../../lib/admin"
import { formatBlock, formatDay, formatDuration, formatPercent, formatRelative } from "../../lib/format"
import { BLOCKS, DAY_LABELS } from "../../lib/time"
import type { Heatmap as HeatmapData, Machine, MachineGroup } from "../../types"
import { Card } from "../Card"
import { Heatmap } from "../Heatmap"
import { MachineTile } from "../MachineTile"
import { ExportButton } from "./Popularity"

const AXIS = { fontSize: 12, fill: "#57534e" }
const GRID = "#E7E2D8"
const BAR = "#1E7A4C"

const REC_STYLE = {
  buy: { icon: ShoppingCart, label: "Invest", tint: "#E2F4E6", ink: "#1B7234" },
  replace: { icon: CircleSlash, label: "Rethink", tint: "#FCF3D2", ink: "#7A5A00" },
  service: { icon: Wrench, label: "Service", tint: "#FDE8D7", ink: "#A04A06" },
} as const

// buy / replace / service suggestions
export function RecommendationsSection({ recs, onExport }: { recs: recommendation[]; onExport: () => void }) {
  return (
    <Card title="Investment recommendations" headingID="rec-title" action={<ExportButton onClick={onExport} label="CSV" />}>
      {recs.length === 0 ? (
        <p className="text-sm text-stone-600">Nothing stands out: no machine type is saturated and nothing is badly under-used.</p>
      ) : (
        <ul className="space-y-2.5">
          {recs.map((r) => {
            const st = REC_STYLE[r.type]
            const Icon = st.icon
            return (
              <li key={r.title} className="flex gap-3 rounded-lg p-3" style={{ backgroundColor: st.tint }}>
                <Icon size={20} className="mt-0.5 shrink-0" style={{ color: st.ink }} aria-hidden />
                <div>
                  <p className="font-semibold text-stone-900">
                    <span className="mr-1.5 text-xs font-bold tracking-wide uppercase" style={{ color: st.ink }}>
                      {st.label}
                    </span>
                    {r.title}
                  </p>
                  <p className="text-sm text-stone-700">{r.detail}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-stone-500">Generated from the last 4 weeks of sensor data. Thresholds are in src/lib/admin.ts.</p>
    </Card>
  )
}

export interface groupSaturation {
  group: MachineGroup
  values: number[][]
  weekdayEvening: number // weekday 5–7 pm, pooled
  operational: number
}

// how often every unit of a group or kind was busy at once
export function SaturationSection({ groups, kinds, now }: { groups: groupSaturation[]; kinds: kindRow[]; now: Date }) {
  const multi = kinds.filter((k) => k.units.length >= 2).sort((x, y) => y.weekdayEvening - x.weekdayEvening)
  return (
    <Card title="Group demand vs supply" headingID="sat-title">
      <p className="mb-4 text-sm text-stone-700">
        <strong>Saturation</strong>: how often <em>every</em> in-service machine in a group was taken at the same time, so a new arrival had to wait. High
        saturation means demand outstrips supply.
      </p>
      {multi.length > 0 && (
        <div className="mb-5 overflow-x-auto">
          <table className="w-full min-w-[360px] text-sm">
            <caption className="mb-1 text-left text-xs font-semibold tracking-wide text-stone-600 uppercase">
              By kind: all units busy at once, weekday 5–7 pm
            </caption>
            <tbody className="divide-y divide-stone-100">
              {multi.map((k) => (
                <tr key={k.kind}>
                  <th scope="row" className="py-1.5 text-left font-medium text-stone-800">
                    {kindPlural(k.kind)} ×{k.units.length}
                    <span className="block text-xs font-normal text-stone-500">{formatPercent(k.utilisation)} average use</span>
                  </th>
                  <td className="w-1/2 py-1.5">
                    <div className="h-2.5 overflow-hidden rounded-full bg-heat-0" aria-hidden>
                      <div className="h-full rounded-full bg-forest-mid" style={{ width: formatPercent(k.weekdayEvening) }} />
                    </div>
                  </td>
                  <td className="py-1.5 pl-3 text-right font-semibold tabular-nums">{formatPercent(k.weekdayEvening)} all busy</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {groups.map((g) => (
          <div key={g.group}>
            <h3 className="mb-1 text-sm font-bold" style={{ color: GROUP_STYLE[g.group].ink }}>
              {GROUP_LABELS[g.group]} · {g.operational} in service · weekday 5–7 pm {formatPercent(g.weekdayEvening)}
            </h3>
            <Heatmap
              heatmap={toHeatmap(g.values)}
              now={now}
              unit="all busy at once"
              caption={`Share of each block when every ${GROUP_LABELS[g.group]} machine was busy at once`}
            />
          </div>
        ))}
      </div>
    </Card>
  )
}

// wraps a plain [day][block] grid as a heatmap so the Heatmap component can draw it
function toHeatmap(values: number[][]): HeatmapData {
  let best = { d: 0, b: 0, v: 0 }
  for (let d = 0; d < values.length; d++) {
    for (let b = 0; b < values[d].length; b++) {
      const v = values[d][b]
      if (v > best.v) best = { d, b, v }
    }
  }
  return {
    machineId: "ALL",
    weeks: 4,
    blocks: BLOCKS.map((b) => b.label),
    days: [...DAY_LABELS],
    values,
    busiest: { day: DAY_LABELS[best.d], block: BLOCKS[best.b].label, value: best.v },
  }
}

// whole gym heatmap + the 4 week trend
export function PeakHoursSection({ heatmap, trend, now }: { heatmap: HeatmapData; trend: { label: string; utilisation: number }[]; now: Date }) {
  // the quietest block of the week
  let quiet = { d: 0, b: 0, v: Infinity }
  for (let d = 0; d < heatmap.values.length; d++) {
    for (let b = 0; b < heatmap.values[d].length; b++) {
      const v = heatmap.values[d][b]
      if (v < quiet.v) quiet = { d, b, v }
    }
  }
  return (
    <Card title="Peak hours" headingID="peak-title">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-cream px-3 py-2">
          <p className="text-xs font-semibold text-stone-600 uppercase">Busiest block</p>
          <p className="font-display text-2xl text-forest">
            {formatDay(heatmap.busiest.day)} {formatBlock(heatmap.busiest.block)}
          </p>
          <p className="text-xs text-stone-600">{formatPercent(heatmap.busiest.value)} of machines in use</p>
        </div>
        <div className="rounded-lg bg-cream px-3 py-2">
          <p className="text-xs font-semibold text-stone-600 uppercase">Quietest block</p>
          <p className="font-display text-2xl text-forest">
            {formatDay(DAY_LABELS[quiet.d])} {formatBlock(BLOCKS[quiet.b].label)}
          </p>
          <p className="text-xs text-stone-600">{formatPercent(quiet.v)} of machines in use</p>
        </div>
      </div>
      <Heatmap heatmap={heatmap} now={now} markBusiest caption="Share of the gym's machines in use, by weekday and block, averaged over 4 weeks" />
      <h3 className="mt-5 mb-1 text-sm font-semibold text-stone-800">Gym-wide utilisation by week</h3>
      <div className="h-44">
        <ResponsiveContainer>
          <BarChart data={trend} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis tickFormatter={(v: number) => formatPercent(v)} tick={AXIS} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              formatter={(v) => [formatPercent(Number(v)), "Utilisation"]}
              cursor={{ fill: "rgb(0 0 0 / 0.04)" }}
              contentStyle={{ borderRadius: 8, fontSize: 13 }}
            />
            <Bar
              dataKey="utilisation"
              fill={BAR}
              radius={[4, 4, 0, 0]}
              maxBarSize={56}
              isAnimationActive={false}
              label={{ position: "top", fontSize: 12, fill: "#44403c", formatter: (v: unknown) => formatPercent(Number(v)) }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-stone-500">“This week” is partial (up to now).</p>
    </Card>
  )
}

// session lengths and how long people rest between sets
export function SessionInsightsSection({
  byGroup,
  perDay,
  rests,
}: {
  byGroup: { group: MachineGroup; avgSeconds: number; sessions: number }[]
  perDay: { date: string; count: number }[]
  rests: restInsightsType
}) {
  const days = perDay.map((d) => ({ ...d, label: new Date(`${d.date}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" }) }))
  return (
    <Card title="Session insights" headingID="sess-title">
      <h3 className="text-sm font-semibold text-stone-800">Average session length by group</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {byGroup.map((g) => (
          <div key={g.group} className="rounded-lg px-3 py-2" style={{ backgroundColor: GROUP_STYLE[g.group].tint }}>
            <dt className="text-xs font-bold" style={{ color: GROUP_STYLE[g.group].ink }}>
              {GROUP_LABELS[g.group]}
            </dt>
            <dd className="font-display text-2xl leading-none text-stone-900">{formatDuration(g.avgSeconds)}</dd>
            <dd className="text-[11px] text-stone-600">{g.sessions} sessions</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-5 text-sm font-semibold text-stone-800">Sessions per day, whole gym</h3>
      <div className="h-48">
        <ResponsiveContainer>
          <LineChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={6} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
            <Tooltip formatter={(v) => [String(v), "Sessions"]} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
            <Line dataKey="count" stroke={BAR} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h3 className="mt-5 text-sm font-semibold text-stone-800">Rests between sets</h3>
      <p className="text-sm text-stone-700">
        Average rest {formatDuration(rests.avgRestSeconds)}. <strong>{formatPercent(rests.longShare)}</strong> of rests run past 3 minutes and{" "}
        <strong>{formatPercent(rests.nearTimeoutShare)}</strong> past 4, close to the 5-minute timeout that frees the machine. Long rests keep machines looking
        taken.
      </p>
      <div className="mt-2 h-40">
        <ResponsiveContainer>
          <BarChart data={rests.buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
            <Tooltip formatter={(v) => [String(v), "Rests"]} cursor={{ fill: "rgb(0 0 0 / 0.04)" }} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="count" fill={BAR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

// every node, online or not, and its last heartbeat
export function SensorHealthSection({ machines, now }: { machines: Machine[] | undefined; now: Date }) {
  if (!machines)
    return (
      <Card title="Sensor health" headingID="sensor-title">
        <p className="text-sm text-stone-600">Loading…</p>
      </Card>
    )
  const online = machines.filter((m) => m.online).length
  const sorted = [...machines].sort((a, b) => Number(a.online) - Number(b.online) || a.id.localeCompare(b.id))
  return (
    <Card title="Sensor health" headingID="sensor-title">
      <p className="mb-3 text-sm text-stone-700">
        <strong>{online}</strong> of {machines.length} nodes online. A node is marked offline after 90 s without a packet or heartbeat (sent every 30 s).
      </p>
      <div className="max-h-[26rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white text-xs text-stone-600">
            <tr className="border-b border-stone-200">
              <th scope="col" className="py-1.5 text-left">
                Node
              </th>
              <th scope="col" className="py-1.5 text-left">
                Status
              </th>
              <th scope="col" className="py-1.5 text-right">
                Last heartbeat
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sorted.map((m) => (
              <tr key={m.id}>
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <MachineTile machine={m} size={24} />
                    <span>
                      <span className="font-semibold">{m.id}</span> {m.name}
                      {m.prototype && <span className="ml-1.5 rounded bg-forest px-1 py-px text-[10px] font-bold text-cream">PROTOTYPE</span>}
                    </span>
                  </span>
                </td>
                <td className="py-1.5">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${m.online ? "text-[#1B7234]" : "text-active"}`}>
                    <span className={`size-2 rounded-full ${m.online ? "bg-available" : "bg-active"}`} aria-hidden />
                    {m.online ? "Online" : "Offline"}
                  </span>
                </td>
                <td className="py-1.5 text-right text-xs text-stone-600 tabular-nums">{m.lastHeartbeat ? formatRelative(m.lastHeartbeat, now) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
