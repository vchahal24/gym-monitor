// PLAN PAGE
// Purpose: Plan Your Workout, the Today and Weekly plan tabs

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { TodayPlanner } from "../components/planner/TodayPlanner"
import { WeeklyPlanner } from "../components/planner/WeeklyPlanner"
import { DEFAULT_WEEKLY, MAX_WORKOUTS, type weeklyForm } from "../components/planner/weeklyForm"
import { useMachines, useNow, usePlannerData } from "../hooks"
import { GYM_LAYOUT } from "../config/gym-layout"
import { TODAY_PRESETS, buildPlannerKinds, cleanForm, cleanPicked, liveUnitSets } from "../lib/planner"
import { readJSON, writeJSON } from "../lib/storage"
import type { MachineKind } from "../types"

const TODAY_KEY = "gym-monitor.plan.today"
const WEEKLY_KEY = "gym-monitor.plan.weekly"
// picks and plans are stored by kind, anything else (old machine IDs) gets dropped
const KNOWN_KINDS: ReadonlySet<MachineKind> = new Set(GYM_LAYOUT.map((l) => l.kind))

// Plan Your Workout, Today mode and Weekly plan mode (the logic is in src/lib/planner)
export function PlanPage() {
  const [params, setParams] = useSearchParams()
  const mode = params.get("mode") === "week" ? "week" : "today"
  const now = useNow(1000)
  const { machines } = useMachines()
  const { data, live, avgWorkout } = usePlannerData()
  // the picker works off the live machine list even before the history has loaded
  const pickerKinds = useMemo(
    () => live?.kinds ?? buildPlannerKinds({ live: liveUnitSets(machines), availability: [], unitOccupancy: new Map(), avgWorkout: new Map() }),
    [live, machines],
  )
  const [picked, setPicked] = useState<MachineKind[]>(() => {
    // ?preset=Legs preselects a preset (shareable links)
    const preset = TODAY_PRESETS.find((p) => p.name.toLowerCase() === params.get("preset")?.toLowerCase())
    return preset ? preset.kinds : cleanPicked(readJSON<unknown>(TODAY_KEY, []), KNOWN_KINDS)
  })
  // stored data from older versions (machine IDs like "M02" or "TM01") gets cleaned, never trusted
  const [form, setForm] = useState<weeklyForm>(() => {
    const f = cleanForm(readJSON<unknown>(WEEKLY_KEY, null), DEFAULT_WEEKLY, KNOWN_KINDS)
    return {
      ...f,
      count: Math.min(MAX_WORKOUTS, Math.max(1, Math.round(f.count) || DEFAULT_WEEKLY.count)),
      restMode: f.restMode === "pattern" ? "pattern" : "min",
      minRest: Math.min(3, Math.max(0, Math.round(f.minRest) || 0)),
    }
  })
  useEffect(() => void writeJSON(TODAY_KEY, picked), [picked])
  useEffect(() => void writeJSON(WEEKLY_KEY, form), [form])

  function tab(m: "today" | "week", label: string) {
    return (
      <button
        type="button"
        role="tab"
        aria-selected={mode === m}
        onClick={() => setParams(m === "week" ? { mode: "week" } : {}, { replace: true })}
        className={`rounded-full px-4 py-1.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
          mode === m ? "bg-forest text-cream" : "bg-white text-forest ring-1 ring-forest/30 hover:bg-cream"
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl leading-none text-brown sm:text-5xl">Plan your workout</h1>
          <p className="mt-1 text-sm text-stone-600">
            Pick the kinds of machine you want; we work out how likely one is free (from the last 4 weeks) and which one to use. Machines in maintenance or
            without sensor data are never suggested.
          </p>
        </div>
        <div role="tablist" aria-label="Planner mode" className="flex gap-2 print:hidden">
          {tab("today", "Today")}
          {tab("week", "Weekly plan")}
        </div>
      </div>
      {mode === "today" ? (
        <TodayPlanner machines={machines} kinds={pickerKinds} data={live} avgWorkout={avgWorkout} picked={picked} onPick={setPicked} now={now} />
      ) : (
        <WeeklyPlanner kinds={pickerKinds} data={data} form={form} onForm={setForm} />
      )}
    </div>
  )
}
