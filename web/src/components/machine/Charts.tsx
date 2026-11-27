// MACHINE CHARTS
// Purpose: the charts on the machine detail page, hourly occupancy, sessions per day and session lengths

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { formatDuration, formatPercent } from "../../lib/format"
import { CHART_HOURS } from "../../lib/hourly"
import type { bin } from "../../lib/histogram"

const TODAY = "#1E7A4C"
const TYPICAL = "#C27A12"
const BAR = "#1E7A4C"
const GRID = "#E7E2D8"
const AXIS = { fontSize: 12, fill: "#57534e" }

// 17 -> "5 pm"
function hourLabel(h: number) {
  if (h === 12) return "12 pm"
  if (h > 12) return `${h - 12} pm`
  return `${h} am`
}

// hourly occupancy today (solid) vs the 4 week average for the same weekday (dashed)
export function TodayVsTypicalChart({ today, typical, weekday }: { today: (number | null)[]; typical: (number | null)[]; weekday: string }) {
  const data = CHART_HOURS.map((h, i) => ({ hour: hourLabel(h), today: today[i], typical: typical[i] }))
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="hour" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={1} />
          <YAxis domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v)} tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            formatter={(v, name) => [v == null ? "—" : formatPercent(Number(v)), name === "today" ? "Today" : `Typical ${weekday}`]}
            contentStyle={{ borderRadius: 8, fontSize: 13 }}
          />
          <Legend formatter={(v) => (v === "today" ? "Today" : `Typical ${weekday} (4-week average)`)} wrapperStyle={{ fontSize: 13 }} />
          <Line type="monotone" dataKey="typical" stroke={TYPICAL} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
          <Line type="monotone" dataKey="today" stroke={TODAY} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// completed sessions per day over the last 4 weeks
export function SessionsPerDayChart({ data }: { data: { date: string; count: number }[] }) {
  const rows = data.map((d) => {
    const date = new Date(`${d.date}T12:00:00`)
    return { ...d, label: date.toLocaleDateString([], { day: "numeric", month: "short" }), weekday: date.toLocaleDateString([], { weekday: "short" }) }
  })
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={6} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            formatter={(v) => [String(v), "Sessions"]}
            labelFormatter={(_, p) => (p?.[0] ? `${p[0].payload.weekday} ${p[0].payload.label}` : "")}
            cursor={{ fill: "rgb(0 0 0 / 0.04)" }}
            contentStyle={{ borderRadius: 8, fontSize: 13 }}
          />
          <Bar dataKey="count" fill={BAR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// distribution of session lengths (workout time), with mean and median marked
export function SessionLengthHistogram({ bins, mean, median }: { bins: bin[]; mean: number; median: number }) {
  const width = bins.length ? bins[0].to - bins[0].from : 60
  const rows = bins.map((b, i) => ({
    mid: (b.from + b.to) / 2,
    label: i === bins.length - 1 ? `${Math.round(b.from / 60)}+` : `${Math.round(b.from / 60)}–${Math.round(b.to / 60)}`,
    count: b.count,
  }))
  const max = bins.length ? bins[bins.length - 1].to : 0
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 22, right: 12, bottom: 12, left: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="mid"
            type="number"
            domain={[0, max]}
            ticks={bins.map((b) => b.from).concat(max)}
            tickFormatter={(v: number) => `${Math.round(v / 60)}`}
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            label={{ value: "minutes", position: "insideBottomRight", offset: -8, fontSize: 12, fill: "#57534e" }}
          />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            formatter={(v) => [String(v), "Sessions"]}
            labelFormatter={(_, p) => (p?.[0] ? `${p[0].payload.label} min` : "")}
            cursor={{ fill: "rgb(0 0 0 / 0.04)" }}
            contentStyle={{ borderRadius: 8, fontSize: 13 }}
          />
          <Bar dataKey="count" fill={BAR} radius={[4, 4, 0, 0]} barSize={Math.max(6, 280 / Math.max(1, bins.length))} isAnimationActive={false} />
          <ReferenceLine
            x={Math.min(mean, max - width / 2)}
            stroke="#5A2E1F"
            strokeWidth={2}
            label={{
              value:
                Math.abs(mean - median) < width ? `mean ${formatDuration(mean)} · median ${formatDuration(median)} (dashed)` : `mean ${formatDuration(mean)}`,
              position: "top",
              fontSize: 12,
              fill: "#5A2E1F",
            }}
          />
          <ReferenceLine
            x={Math.min(median, max - width / 2)}
            stroke="#5A2E1F"
            strokeDasharray="4 3"
            strokeWidth={2}
            label={
              Math.abs(mean - median) < width
                ? undefined
                : { value: `median ${formatDuration(median)}`, position: "insideTopRight", fontSize: 12, fill: "#5A2E1F" }
            }
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
