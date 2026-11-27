// CLEANING PAGE
// Purpose: zone load since the last clean, alerts and the recommended cleaning schedule

import { Brush, CheckCircle2, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"
import { Card } from "../../components/Card"
import { cleaningThreshold, DEEP_CLEAN_HOURS } from "../../config/cleaning"
import { FLOOR_ZONES, GROUP_STYLE, GYM_LAYOUT, zoneOf } from "../../config/gym-layout"
import { hourLabel } from "../../config/gym-hours"
import { useZones } from "../../hooks"
import { CLEAN_HOURS, cleaningSchedule, expectedZoneLoad, todaysCleaning, zoneAlert, type cleaningPlan } from "../../lib/cleaning"
import { formatRelative } from "../../lib/format"
import { DAY_LABELS, mondayIndex } from "../../lib/time"
import { useAdmin } from "./context"

const ZONE_NAME = new Map(FLOOR_ZONES.map((z) => [z.id, z.label.split(" · ")[0]]))
const ZONE_GROUP = new Map(FLOOR_ZONES.map((z) => [z.id, z.group]))
const ZONE_MACHINES = GYM_LAYOUT.map((m) => ({ id: m.id, zoneId: zoneOf(m) }))

export function CleaningPage() {
  const { raw, now } = useAdmin()
  const { zones, error, markCleaned } = useZones()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const plan = useMemo(() => (raw ? cleaningSchedule(expectedZoneLoad(raw.events, ZONE_MACHINES, new Date(raw.at))) : null), [raw])

  async function clean(zoneId: string) {
    setBusy(zoneId)
    setMessage(null)
    try {
      await markCleaned(zoneId)
      setMessage(`${ZONE_NAME.get(zoneId)} marked as cleaned.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Card title="Zone load since last clean" headingID="cl-zones">
        {error && <p className="text-sm text-active">Couldn't load zones: {error.message}</p>}
        {message && (
          <p role="status" className="mb-3 rounded-md bg-[#E2F4E6] px-3 py-2 text-sm font-semibold text-[#1B7234]">
            {message}
          </p>
        )}
        {!zones ? (
          <p className="text-sm text-stone-600">Loading…</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {zones.map((z) => {
              const a = zoneAlert(z)
              const t = cleaningThreshold(z.zoneId)
              const group = ZONE_GROUP.get(z.zoneId)
              const pct = Math.min(1, a.ratio)
              return (
                <li key={z.zoneId} className="rounded-xl p-3.5 ring-1 ring-black/5" style={{ backgroundColor: group ? GROUP_STYLE[group].tint : "#fff" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-2xl leading-none text-brown">{ZONE_NAME.get(z.zoneId) ?? z.zoneId}</h3>
                      <p className="mt-0.5 text-xs text-stone-600">Last cleaned {formatRelative(z.lastCleaned, now)}</p>
                    </div>
                    {a.over ? (
                      <span className="rounded-full bg-active px-2 py-0.5 text-xs font-bold text-white">Needs a wipe-down</span>
                    ) : (
                      <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-stone-700">
                        {Math.round(a.ratio * 100)}% of threshold
                      </span>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-stone-600">Sessions</dt>
                      <dd className="font-semibold tabular-nums text-stone-900">
                        {z.sessionsSince} <span className="text-xs font-normal text-stone-500">/ {t.sessions}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-stone-600">Occupied time</dt>
                      <dd className="font-semibold tabular-nums text-stone-900">
                        {Math.round(z.occupiedMinutesSince / 60)} h{" "}
                        <span className="text-xs font-normal text-stone-500">/ {Math.round(t.occupiedMinutes / 60)} h</span>
                      </dd>
                    </div>
                  </dl>
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-white/80"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(a.ratio * 100)}
                    aria-label="Load against threshold"
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct * 100}%`, backgroundColor: a.over ? "#D64545" : a.ratio > 0.75 ? "#E8A33D" : "#1E7A4C" }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => clean(z.zoneId)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-forest px-3 py-1.5 text-sm font-semibold text-cream hover:bg-forest-mid disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-mustard"
                  >
                    <CheckCircle2 size={15} aria-hidden /> {busy === z.zoneId ? "Saving…" : "Mark zone cleaned"}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {!plan ? (
        <div className="h-80 animate-pulse rounded-xl bg-white/70 ring-1 ring-black/5" aria-busy="true" aria-label="Working out the cleaning schedule" />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_22rem]">
          <ScheduleGrid plan={plan} now={now} />
          <TodayList plan={plan} now={now} />
        </div>
      )}
    </>
  )
}

const HEAT = ["#E3F1E6", "#B9DCC2", "#86C09A", "#4F9E6D", "#1E7A4C", "#0B4A2E"]

function ScheduleGrid({ plan, now }: { plan: cleaningPlan; now: Date }) {
  const max = Math.max(...plan.grid.flat())
  const today = mondayIndex(now)
  const slotAt = new Map(plan.slots.map((s) => [`${s.day}:${s.hour}`, s]))
  const deepAt = new Map<string, true>()
  for (const d of plan.deep) for (let h = d.hour; h < d.hour + d.hours; h++) deepAt.set(`${d.day}:${h}`, true)
  const hours = plan.slots.reduce((s, x) => s + x.cleanerHours, 0) + plan.deep.length * DEEP_CLEAN_HOURS
  return (
    <Card title="Recommended weekly schedule" headingID="cl-grid">
      <p className="mb-3 text-sm text-stone-700">
        Cells show expected machine use (darker = busier, 4-week average). <Brush size={13} className="inline" aria-label="Brush" /> marks a wipe-down visit
        with its cleaner-hours; <Sparkles size={13} className="inline" aria-label="Sparkles" /> marks a {DEEP_CLEAN_HOURS}-hour deep clean in the quietest
        windows. About <strong>{hours.toFixed(1)}</strong> cleaner-hours a week.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-0.5 text-center text-[11px]">
          <caption className="sr-only">Cleaning schedule by weekday and opening hour</caption>
          <thead>
            <tr>
              <th scope="col" className="w-12" />
              {CLEAN_HOURS.map((h) => (
                <th key={h} scope="col" className="font-semibold text-stone-500">
                  {h % 3 === 0 ? hourLabel(h).replace(" ", "") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.grid.map((row, d) => (
              <tr key={d}>
                <th scope="row" className={`pr-1 text-right font-bold ${d === today ? "text-forest" : "text-stone-600"}`}>
                  {DAY_LABELS[d].slice(0, 3)}
                </th>
                {row.map((v, i) => {
                  const h = CLEAN_HOURS[i]
                  const slot = slotAt.get(`${d}:${h}`)
                  const deep = deepAt.has(`${d}:${h}`)
                  const level = Math.min(HEAT.length - 1, Math.floor((v / (max || 1)) * HEAT.length))
                  const label = `${DAY_LABELS[d]} ${hourLabel(h)}: ${v.toFixed(1)} machine-hours in use${slot ? `; wipe-down, ${slot.cleanerHours} cleaner-hours (${slot.reason})` : ""}${deep ? "; deep clean" : ""}`
                  return (
                    <td
                      key={h}
                      title={label}
                      aria-label={label}
                      className={`h-8 rounded-sm ${deep ? "ring-2 ring-mustard ring-inset" : ""}`}
                      style={{ backgroundColor: HEAT[level], color: level >= 3 ? "#FBF7EF" : "#0B4A2E" }}
                    >
                      {slot ? (
                        <span className="flex flex-col items-center leading-none font-bold">
                          <Brush size={11} aria-hidden />
                          {slot.cleanerHours}
                        </span>
                      ) : deep ? (
                        <Sparkles size={12} className="mx-auto text-mustard" aria-hidden />
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function TodayList({ plan, now }: { plan: cleaningPlan; now: Date }) {
  const t = todaysCleaning(plan, now)
  const items = [
    ...t.slots.map((s) => ({
      hour: s.hour,
      end: s.hour + 1,
      status: s.status,
      title: `Wipe-down · ${s.cleanerHours} cleaner-hour${s.cleanerHours === 1 ? "" : "s"}`,
      detail: `${s.reason}. Start with ${s.zones
        .slice(0, 2)
        .map((z) => ZONE_NAME.get(z.zoneId))
        .join(", then ")}.`,
      deep: false,
    })),
    ...t.deep.map((d) => ({
      hour: d.hour,
      end: d.hour + d.hours,
      status: d.status,
      title: `Deep clean · ${d.hours} h`,
      detail: "One of the quietest windows of the week.",
      deep: true,
    })),
  ].sort((a, b) => a.hour - b.hour)
  const tone = { done: "text-stone-400", now: "text-stone-900", upcoming: "text-stone-800" }
  return (
    <Card title={`Today · ${DAY_LABELS[mondayIndex(now)]}`} headingID="cl-today">
      {items.length === 0 ? (
        <p className="text-sm text-stone-600">No visits planned today.</p>
      ) : (
        <ol className="space-y-2.5">
          {items.map((i) => (
            <li
              key={`${i.hour}${i.deep}`}
              className={`flex gap-3 rounded-lg p-2.5 ${i.status === "now" ? "bg-[#FCF3D2] ring-1 ring-mustard" : "bg-cream"} ${tone[i.status]}`}
            >
              <span className="w-16 shrink-0 text-sm font-bold tabular-nums">{hourLabel(i.hour)}</span>
              <div className="min-w-0 text-sm">
                <p className="font-semibold">
                  {i.deep ? <Sparkles size={13} className="mr-1 inline text-mustard" aria-hidden /> : <Brush size={13} className="mr-1 inline" aria-hidden />}
                  {i.title}
                  {i.status === "now" && <span className="ml-1.5 rounded-full bg-mustard px-1.5 text-[10px] font-bold text-brown">NOW</span>}
                  {i.status === "done" && <span className="ml-1.5 text-[10px] font-bold uppercase">done</span>}
                </p>
                <p className="text-xs">{i.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
