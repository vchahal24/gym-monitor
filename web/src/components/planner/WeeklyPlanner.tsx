// WEEKLY PLANNER
// Purpose: the Weekly plan tab of Plan Your Workout, form, plans, save, .ics and print

import { CalendarPlus, Printer, Save, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { formatDateTime } from "../../lib/format"
import { GYM_LAYOUT } from "../../config/gym-layout"
import {
  AVAILABILITY_PRESETS,
  DAY_PRESETS,
  cleanSavedPlans,
  planToICS,
  planWeek,
  resolveKinds,
  substitutionText,
  type Plan,
  type plannerData,
  type plannerKind,
  type savedPlan,
} from "../../lib/planner"
import { downloadText, readJSON, writeJSON } from "../../lib/storage"
import { BLOCKS, DAY_LABELS } from "../../lib/time"
import { Card } from "../Card"
import { formPattern, MAX_WORKOUTS, withPattern, type weeklyForm } from "./weeklyForm"
import { PlanCalendar } from "./PlanCalendar"
import { RestPatternEditor } from "./RestPatternEditor"
import { GymBusy, PFree, ScoreBadge } from "./bits"
import { dayName, slotTime } from "./format"
import { KindPicker } from "./KindPicker"
import { UnitLink } from "./TodayPlanner"

const SAVED_KEY = "gym-monitor.saved-plans"
const KNOWN_IDS: ReadonlySet<string> = new Set(GYM_LAYOUT.map((l) => l.kind))

// saved plans stored by unit (older versions) or with unknown kinds are dropped
function loadSaved(): savedPlan[] {
  const { plans, dropped } = cleanSavedPlans(readJSON<unknown>(SAVED_KEY, []), KNOWN_IDS)
  if (dropped > 0) writeJSON(SAVED_KEY, plans)
  return plans
}

// the form, then the 3 alternative plans
export function WeeklyPlanner({
  kinds,
  data,
  form,
  onForm,
}: {
  kinds: plannerKind[] // for the pickers (works before history has loaded)
  data: plannerData | undefined
  form: weeklyForm
  onForm: (f: weeklyForm) => void
}) {
  const [saved, setSaved] = useState<savedPlan[]>(loadSaved)
  const [printOnly, setPrintOnly] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  useEffect(() => {
    if (!printOnly) return
    const t = setTimeout(() => {
      window.print()
      setPrintOnly(null)
    }, 50)
    return () => clearTimeout(t)
  }, [printOnly])

  const result = useMemo(() => {
    if (!data) return null
    return planWeek(
      {
        workouts: form.workouts.slice(0, form.count),
        availability: form.availability,
        minRestDays: form.minRest,
        sameTime: form.sameTime,
        pattern: form.restMode === "pattern" ? formPattern(form) : null,
      },
      data,
    )
  }, [data, form])
  const pattern = formPattern(form)

  const names = new Map<string, string>(kinds.map((k) => [k.id, k.name]))
  function setWorkout(i: number, patch: Partial<weeklyForm["workouts"][number]>) {
    return onForm({ ...form, workouts: form.workouts.map((w, j) => (j === i ? { ...w, ...patch } : w)) })
  }

  function save(plan: Plan) {
    const savedAt = new Date().toISOString()
    const next = [{ id: `${savedAt}-${plan.strategy}`, savedAt, plan }, ...saved].slice(0, 10)
    setSaved(next)
    setSavedNote(writeJSON(SAVED_KEY, next) ? `Saved “${plan.title}”.` : "Saved for this visit only: your browser blocked storage.")
  }
  function remove(id: string) {
    const next = saved.filter((s) => s.id !== id)
    setSaved(next)
    writeJSON(SAVED_KEY, next)
  }
  function exportICS(plan: Plan) {
    if (!data) return
    downloadText(`workout-plan-${plan.strategy}.ics`, planToICS(plan, data.kinds), "text/calendar")
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5 print:hidden">
        <Card title="Your workouts" headingID="wk-workouts" className="xl:col-span-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            Workouts per week
            <select
              value={form.count}
              onChange={(e) => onForm({ ...form, count: Number(e.target.value) })}
              className="rounded-md border border-stone-300 bg-white px-2 py-1"
            >
              {Array.from({ length: MAX_WORKOUTS }, (_, i) => i + 1).map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          {form.count === 7 && (
            <p className="mt-2 rounded-lg bg-[#FCF3D2] px-3 py-2 text-sm text-[#5C4300]">
              7 workouts means no rest days. That's fine if you alternate muscle groups or keep some days light.
            </p>
          )}
          <div className="mt-4 space-y-3">
            {form.workouts.slice(0, form.count).map((w, i) => (
              <details key={i} className="group rounded-lg bg-cream p-3" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <span className="font-display text-2xl text-mustard">{String.fromCharCode(65 + i)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-stone-900">{w.name || `Workout ${i + 1}`}</span>
                    <span className="block truncate text-xs text-stone-600">
                      {w.kinds.length ? w.kinds.map((id) => names.get(id) ?? id).join(", ") : "No machines yet"}
                    </span>
                  </span>
                  <span className="text-xs text-forest-mid group-open:hidden">Edit</span>
                </summary>
                <div className="mt-3 space-y-3">
                  <label className="block text-sm">
                    <span className="font-semibold text-stone-800">Name</span>
                    <input
                      value={w.name}
                      onChange={(e) => setWorkout(i, { name: e.target.value })}
                      className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1.5"
                    />
                  </label>
                  <KindPicker
                    kinds={kinds}
                    value={w.kinds}
                    onChange={(ids) => setWorkout(i, { kinds: ids })}
                    presets={DAY_PRESETS.map((p) => ({ name: p.name.replace(/^Day \w: /, ""), kinds: p.kinds }))}
                    compact
                  />
                </div>
              </details>
            ))}
          </div>
        </Card>

        <Card title="When you can train" headingID="wk-avail" className="xl:col-span-2">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {AVAILABILITY_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => onForm({ ...form, availability: DAY_LABELS.map((_, d) => BLOCKS.map((_, b) => p.test(d, b))) })}
                className="rounded-full border border-forest/30 bg-white px-3 py-1 text-sm font-medium text-forest hover:bg-forest hover:text-cream"
              >
                {p.name}
              </button>
            ))}
          </div>
          <AvailabilityGrid value={form.availability} onChange={(availability) => onForm({ ...form, availability })} />
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <label className="flex items-center gap-2 font-semibold text-stone-800">
              <input
                type="checkbox"
                checked={form.sameTime}
                onChange={(e) => onForm({ ...form, sameTime: e.target.checked })}
                className="size-4 accent-forest"
              />
              Keep the same time each day
            </label>
          </div>
        </Card>

        <Card title="Rest days" headingID="wk-rest" className="xl:col-span-5">
          <fieldset>
            <legend className="sr-only">How to space rest days</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["min", "Minimum rest days", "Any days, at least N rest days apart"],
                  ["pattern", "Rest pattern", "Your own cycle: rest days after each workout"],
                ] as const
              ).map(([mode, label, hint]) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2 ring-1 ${form.restMode === mode ? "bg-forest/5 ring-forest" : "bg-white ring-stone-200 hover:bg-cream"}`}
                >
                  <input
                    type="radio"
                    name="rest-mode"
                    checked={form.restMode === mode}
                    onChange={() => onForm({ ...form, restMode: mode })}
                    className="mt-1 accent-forest"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-stone-900">{label}</span>
                    <span className="block text-xs text-stone-600">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4">
            {form.restMode === "min" ? (
              <label className="flex items-center gap-2 text-sm font-semibold text-stone-800">
                Min. rest days between workouts
                <select
                  value={form.minRest}
                  onChange={(e) => onForm({ ...form, minRest: Number(e.target.value) })}
                  className="rounded-md border border-stone-300 bg-white px-2 py-1"
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            ) : (
              <RestPatternEditor pattern={pattern} names={form.workouts.map((w) => w.name)} onChange={(p) => onForm(withPattern(form, p))} />
            )}
          </div>
        </Card>
      </div>

      {!result ? (
        <p className="text-stone-700">Loading 4 weeks of history…</p>
      ) : (
        <>
          {result.notes.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-[#FCF3D2] px-4 py-3 text-sm text-[#5C4300] print:hidden" role="note">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {savedNote && (
            <p className="text-sm font-semibold text-forest print:hidden" role="status">
              {savedNote}
            </p>
          )}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {result.plans.map((p, i) => (
              <div key={p.strategy} className={printOnly && printOnly !== p.strategy ? "print:hidden" : "break-inside-avoid"}>
                <PlanCard plan={p} index={i} names={names} onSave={() => save(p)} onICS={() => exportICS(p)} onPrint={() => setPrintOnly(p.strategy)} />
              </div>
            ))}
          </div>
        </>
      )}

      {saved.length > 0 && (
        <Card title="Saved plans" headingID="wk-saved" className="print:hidden">
          <ul className="divide-y divide-stone-100">
            {saved.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-stone-900">
                    {s.plan.title} · score {s.plan.score}
                  </span>
                  <span className="block text-xs text-stone-600">
                    {s.plan.workouts.map((w) => `${dayName(w.slot.day)} ${slotTime(w.slot)} ${w.name}`).join(" · ")}
                  </span>
                  <span className="block text-xs text-stone-500">Saved {formatDateTime(s.savedAt)}</span>
                  {data &&
                    s.plan.workouts.flatMap((w) =>
                      resolveKinds(
                        w.kinds.map((k) => k.id),
                        data.kinds,
                      ).substitutions.map((sub) => (
                        <span key={`${w.workoutIndex}:${sub.originalId}`} className="block text-xs font-semibold text-[#7A3A08]">
                          {w.name}: {substitutionText(sub, data.kinds).replace("is planned instead", "is the closest swap today")}
                        </span>
                      )),
                    )}
                </span>
                <button
                  type="button"
                  onClick={() => exportICS(s.plan)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-forest hover:bg-cream"
                >
                  <CalendarPlus size={15} aria-hidden /> .ics
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-active hover:bg-[#FBE4E4]"
                  aria-label={`Delete saved plan ${s.plan.title}`}
                >
                  <Trash2 size={15} aria-hidden /> Delete
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

// day x block grid of checkboxes for when they can train
function AvailabilityGrid({ value, onChange }: { value: boolean[][]; onChange: (v: boolean[][]) => void }) {
  function set(d: number, b: number, on: boolean) {
    return onChange(value.map((row, i) => (i === d ? row.map((x, j) => (j === b ? on : x)) : row)))
  }
  function toggleDay(d: number) {
    const on = !value[d].every(Boolean)
    onChange(value.map((row, i) => (i === d ? row.map(() => on) : row)))
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-separate border-spacing-1 text-sm">
        <caption className="sr-only">Times you can train: weekday columns, two-hour block rows</caption>
        <thead>
          <tr>
            <td />
            {DAY_LABELS.map((d, i) => (
              <th key={d} scope="col">
                <button
                  type="button"
                  onClick={() => toggleDay(i)}
                  className="w-full rounded px-1 py-0.5 text-xs font-bold text-forest hover:bg-cream"
                  title={`Toggle all of ${d}`}
                >
                  {d}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map((b, bi) => (
            <tr key={b.label}>
              <th scope="row" className="pr-1 text-left text-xs font-medium whitespace-nowrap text-stone-700">
                {b.label.replace("-", "–")}
              </th>
              {DAY_LABELS.map((d, di) => (
                <td key={d} className="text-center">
                  <input
                    type="checkbox"
                    checked={value[di][bi]}
                    onChange={(e) => set(di, bi, e.target.checked)}
                    aria-label={`${d} ${b.label}`}
                    className="size-5 accent-forest"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// one of the 3 plans with save / .ics / print
function PlanCard({
  plan,
  index,
  names,
  onSave,
  onICS: onICS,
  onPrint,
}: {
  plan: Plan
  index: number
  names: Map<string, string>
  onSave: () => void
  onICS: () => void
  onPrint: () => void
}) {
  return (
    <Card
      title={
        <>
          <span className="text-mustard">{index + 1}.</span> {plan.title}
        </>
      }
      headingID={`plan-${plan.strategy}`}
      className="h-full"
    >
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-sm text-stone-700">{plan.summary}</p>
        <ScoreBadge score={plan.score} />
      </div>
      {plan.calendar && <PlanCalendar plan={plan} />}
      <ol className={`mt-4 space-y-3 ${plan.calendar ? "hidden" : ""}`}>
        {plan.workouts.map((w) => {
          const pf = new Map(w.slot.perMachine.map((p) => [p.id, p.pFree]))
          const unit = new Map(w.units.map((u) => [u.kind, u.unitId]))
          return (
            <li key={w.workoutIndex} className="rounded-lg bg-cream p-3">
              <p className="font-display text-2xl leading-none text-brown">
                {dayName(w.slot.day)} · {slotTime(w.slot)}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-stone-900">{w.name}</p>
              <p className="mt-1 text-sm text-stone-700">{w.explanation}.</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {w.kinds.map((m) => (
                  <PFree key={m.id} name={m.name} p={pf.get(m.id) ?? 0} />
                ))}
              </div>
              <p className="mt-1.5 text-xs text-stone-700">
                <span className="font-semibold">Suggested units:</span>{" "}
                {w.order.map((k, i) => (
                  <span key={k}>
                    {i > 0 && " · "}
                    {names.get(k)} {unit.get(k) ? <UnitLink id={unit.get(k)!} /> : <em>none in service</em>}
                  </span>
                ))}
              </p>
              <div className="mt-1.5">
                <GymBusy occupancy={w.slot.gymOccupancy} />
              </div>
              <p className="mt-1 text-xs text-stone-700">
                <span className="font-semibold">Order:</span> {w.order.map((id) => names.get(id) ?? id).join(" → ")}
              </p>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-xs text-stone-500">
        {plan.cycle
          ? `Rest pattern: ${plan.cycle.order.map((w, i) => `${plan.workouts.find((x) => x.workoutIndex === w)?.name.replace(/^Day \w: /, "") ?? ""} +${plan.cycle!.restAfter[i]}`).join(" → ")} (${plan.cycle.days}-day cycle${plan.cycle.drift ? ", drifts" : ""}).`
          : `At least ${plan.minRest} rest day${plan.minRest === 1 ? "" : "s"} between workouts.`}
        {plan.missed ? ` ${plan.missed} workout day${plan.missed === 1 ? "" : "s"} had no available time slot.` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <ActionButton onClick={onSave} icon={<Save size={15} />} label="Save" />
        <ActionButton onClick={onICS} icon={<CalendarPlus size={15} />} label="Export .ics" />
        <ActionButton onClick={onPrint} icon={<Printer size={15} />} label="Print" />
      </div>
    </Card>
  )
}

// small icon + text button on a plan card
function ActionButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-forest/30 bg-white px-3 py-1.5 text-sm font-semibold text-forest hover:bg-forest hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  )
}
