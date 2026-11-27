// TODAY PLANNER
// Purpose: the Today tab of Plan Your Workout

import { useMemo } from "react"
import { Link } from "react-router"
import { hourLabel } from "../../config/gym-hours"
import { restingTimeoutSecondsFor } from "../../lib/timing"
import { formatDate, formatDuration, formatPercent } from "../../lib/format"
import {
  blocksNeeded,
  displayScore,
  estimateDurationSeconds,
  kindLive,
  machineOrder,
  resolveKinds,
  substitutionText,
  suggestUnits,
  todayOutlook,
  TODAY_PRESETS,
  type datedSlot,
  type plannerData,
  type plannerKind,
  type unitSuggestion,
} from "../../lib/planner"
import { estimateRemainingSeconds } from "../../lib/remaining"
import type { Machine, MachineKind } from "../../types"
import { Card } from "../Card"
import { GymBusy, ScoreBadge } from "./bits"
import { dayName, slotTime } from "./format"
import { KindPicker, KindTile } from "./KindPicker"

// pick kinds -> live status, best times left today, other days and a machine order
export function TodayPlanner({
  machines,
  kinds,
  data,
  avgWorkout,
  picked,
  onPick,
  now,
}: {
  machines: Machine[]
  kinds: plannerKind[] // for the picker (works before history has loaded)
  data: plannerData | undefined // live planner data (unit availability and free-now follow the live store)
  avgWorkout: Map<string, number>
  picked: MachineKind[]
  onPick: (kinds: MachineKind[]) => void
  now: Date
}) {
  const minute = Math.floor(now.getTime() / 60_000)
  const plan = useMemo(() => {
    if (!data || picked.length === 0) return null
    const at = new Date(minute * 60_000)
    const { kinds: resolved, substitutions } = resolveKinds(picked, data.kinds)
    const duration = estimateDurationSeconds(resolved)
    const k = blocksNeeded(duration)
    const outlook = todayOutlook(resolved, data, at, k)
    return { resolved, substitutions, duration, today: outlook.today, days: outlook.laterDays, tomorrow: outlook.tomorrow, nothingLeft: outlook.nothingLeft }
  }, [data, picked, minute])

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      <Card title="Today's machines" headingID="today-pick" className="lg:col-span-2">
        <KindPicker kinds={kinds} value={picked} onChange={onPick} presets={TODAY_PRESETS} />
      </Card>

      <div className="space-y-5 lg:col-span-3">
        {!plan || !data ? (
          <Card title="Your plan for today" headingID="today-plan">
            <p className="text-stone-700">{!data ? "Loading 4 weeks of history…" : "Pick the machines you want to use today, or tap a preset."}</p>
          </Card>
        ) : (
          <>
            {plan.substitutions.length > 0 && (
              <div className="rounded-lg bg-[#FDE8D7] px-4 py-3 text-sm text-[#7A3A08]" role="note">
                {plan.substitutions.map((s) => (
                  <p key={s.originalId}>{substitutionText(s, data.kinds)}</p>
                ))}
              </div>
            )}

            <Card title="Live right now" headingID="today-live">
              <ul className="divide-y divide-stone-100">
                {plan.resolved.map((k) => (
                  <LiveKindRow key={k.id} kind={k} machines={machines} avgWorkout={avgWorkout} now={now} />
                ))}
              </ul>
              <p className="mt-2 text-xs text-stone-500">
                Estimated workout: about {formatDuration(plan.duration)} ({plan.resolved.length} machines + changeovers). Units in maintenance or without sensor
                data are never suggested.
              </p>
            </Card>

            <Card title={plan.nothingLeft ? "Best times tomorrow" : "Best times left today"} headingID="today-best">
              {plan.nothingLeft ? (
                <>
                  <p className="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-800">
                    No time blocks left today: the last one ends at 9 pm. Here are the best times tomorrow and on the days after.
                  </p>
                  <ol className="space-y-3">
                    {plan.tomorrow.map((s, i) => (
                      <SlotCard key={s.start} slot={s} rank={i + 1} kinds={plan.resolved} duration={plan.duration} showDate />
                    ))}
                  </ol>
                </>
              ) : (
                <ol className="space-y-3">
                  {plan.today.slice(0, 4).map((s, i) => (
                    <SlotCard key={s.start} slot={s} rank={i + 1} kinds={plan.resolved} duration={plan.duration} />
                  ))}
                </ol>
              )}
            </Card>

            <Card title={plan.nothingLeft ? "The days after" : "Better days this week"} headingID="today-days">
              {plan.days.length === 0 ? (
                <p className="text-stone-700">No data for other days.</p>
              ) : (
                <>
                  {!plan.nothingLeft && plan.today[0] && plan.days[0] && plan.days[0].score > plan.today[0].score + 0.05 && (
                    <p className="mb-3 text-sm text-stone-700">
                      Today isn't ideal:{" "}
                      <strong>
                        {dayName(plan.days[0].day)} {slotTime(plan.days[0])}
                      </strong>{" "}
                      scores {displayScore(plan.days[0].score) - displayScore(plan.today[0].score)} points higher.
                    </p>
                  )}
                  <ol className="space-y-3">
                    {plan.days.map((s, i) => (
                      <SlotCard key={s.start} slot={s} rank={i + 1} kinds={plan.resolved} duration={plan.duration} showDate />
                    ))}
                  </ol>
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

// a unit code that links to its machine page
export function UnitLink({ id, className = "" }: { id: string; className?: string }) {
  return (
    <Link to={`/machine/${id}`} className={`font-semibold text-forest underline decoration-forest/30 underline-offset-2 hover:decoration-forest ${className}`}>
      {id}
    </Link>
  )
}

// "TM02, TM04" with each one a link
function joinUnits(ids: string[]) {
  return ids.map((id, i) => (
    <span key={id}>
      {i > 0 && ", "}
      <UnitLink id={id} />
    </span>
  ))
}

// the live line per kind, for example "Treadmill: 2 of 3 in service free now (TM02, TM04)"
function LiveKindRow({ kind, machines, avgWorkout, now }: { kind: plannerKind; machines: Machine[]; avgWorkout: Map<string, number>; now: Date }) {
  const { inService, free } = kindLive(kind)
  let detail: React.ReactNode
  if (inService.length === 0) detail = "No unit in service right now"
  else if (free.length > 0) {
    detail =
      inService.length === 1 ? (
        <>Free now ({joinUnits(free.map((u) => u.id))})</>
      ) : (
        <>
          {free.length} of {inService.length} in service free now ({joinUnits(free.map((u) => u.id))})
        </>
      )
  } else {
    // none free, so the unit most likely to free up first
    const soonest = inService
      .map((u) => {
        const m = machines.find((x) => x.id === u.id)
        const r = m ? estimateRemainingSeconds(m, avgWorkout.get(u.id) ?? 0, now) : null
        return { id: u.id, r: r === null || !m ? Infinity : r + restingTimeoutSecondsFor(m) }
      })
      .sort((a, b) => a.r - b.r)[0]
    detail = (
      <>
        {inService.length === 1 ? "Taken right now" : `All ${inService.length} in service are taken`}
        {soonest && Number.isFinite(soonest.r) && (
          <>
            {" "}
            · <UnitLink id={soonest.id} /> likely free in ~{formatDuration(soonest.r)}
          </>
        )}
      </>
    )
  }
  return (
    <li className="flex items-center gap-3 py-2">
      <KindTile kind={kind.id} size={36} dim={free.length === 0} />
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-semibold text-stone-900">{kind.name}</span>
        <span className="block text-stone-700">{detail}</span>
      </span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
          free.length ? "bg-[#E2F4E6] text-[#1B7234]" : "bg-[#FBE4E4] text-[#AE2C2C]"
        }`}
      >
        {free.length ? `${free.length} free` : "none free"}
      </span>
    </li>
  )
}

// one kind in a slot, "Treadmill · 98% chance one is free · usually 3 of 4 free" + the suggested unit
function KindInSlot({ kind, p, typical, suggestion }: { kind: plannerKind; p: number; typical: number; suggestion: unitSuggestion }) {
  const n = kind.units.filter((u) => u.available).length
  let tone = "text-[#AE2C2C]"
  if (p >= 0.7) tone = "text-[#1B7234]"
  else if (p >= 0.45) tone = "text-[#7A5A00]"
  return (
    <li className="rounded-md bg-white/70 px-2.5 py-1.5 text-sm">
      <span className="font-semibold text-stone-900">{kind.name}</span>
      {kind.collectingData ? (
        <span className="text-stone-600"> · not enough data yet (live sensor, still collecting)</span>
      ) : (
        <span className="text-stone-700">
          {" "}
          · <strong className={tone}>{formatPercent(p)}</strong> chance {n > 1 ? "one is" : "it’s"} free
          {n > 1 && ` · usually ${Math.min(n, Math.round(typical))} of ${n} free`}
        </span>
      )}
      {suggestion.unitId && (
        <span className="block text-xs text-stone-600">
          {suggestion.swappedLive ? (
            <>
              We suggest <UnitLink id={suggestion.unitId} />: it’s free right now
            </>
          ) : n > 1 ? (
            <>
              We suggest <UnitLink id={suggestion.unitId} />, usually the quietest at this time
            </>
          ) : (
            <>
              Use <UnitLink id={suggestion.unitId} />
            </>
          )}
        </span>
      )}
    </li>
  )
}

// one suggested time slot with its kinds and units
function SlotCard({
  slot,
  rank,
  kinds,
  duration,
  showDate = false,
}: {
  slot: datedSlot
  rank: number
  kinds: plannerKind[]
  duration: number // estimated workout length, seconds (to warn when the current block is nearly over)
  showDate?: boolean
}) {
  const left = Math.round(slot.remainingMs / 60_000)
  const order = machineOrder(slot)
  const per = new Map(slot.perMachine.map((p) => [p.id, p]))
  // in the block thats happening now, a suggestion thats busy right now is swapped for a free unit
  const suggestions = new Map(suggestUnits(kinds, slot, slot.current).map((s) => [s.kind, s]))
  const byID = new Map(kinds.map((k) => [k.id, k]))
  return (
    <li className="rounded-lg bg-cream p-3">
      <div className="flex items-start gap-3">
        <span className="font-display text-3xl leading-none text-mustard">{rank}</span>
        <div className="min-w-0 flex-1">
          {slot.current ? (
            <p className="font-semibold text-stone-900">
              <span className="mr-1.5 rounded-full bg-active px-2 py-0.5 text-xs font-bold text-white">NOW</span>
              Now until {hourLabel(new Date(slot.end).getHours())} <span className="font-normal text-stone-600">· {formatDuration(left * 60)} left</span>
            </p>
          ) : (
            <p className="font-semibold text-stone-900">
              {showDate ? `${dayName(slot.day)} ${formatDate(slot.start).replace(/^\w+,?\s*/, "")}, ` : ""}
              {slotTime(slot)}
            </p>
          )}
          {slot.current && left * 60 < duration && (
            <p className="text-xs font-semibold text-[#7A5A00]">Not quite enough time for the whole workout (~{formatDuration(duration)}).</p>
          )}
          <GymBusy occupancy={slot.gymOccupancy} />
          <ul className="mt-2 space-y-1">
            {order.map((id) => {
              const k = byID.get(id)!
              const p = per.get(id)!
              return <KindInSlot key={id} kind={k} p={p.pFree} typical={p.typicalFree} suggestion={suggestions.get(id)!} />
            })}
          </ul>
          <p className="mt-2 text-xs text-stone-700">
            <span className="font-semibold">Suggested order:</span>{" "}
            {order.map((id, i) => {
              const unit = suggestions.get(id)?.unitId
              return (
                <span key={id}>
                  {i > 0 && " → "}
                  {byID.get(id)?.name}
                  {unit && (
                    <>
                      {" "}
                      (<UnitLink id={unit} />)
                    </>
                  )}
                </span>
              )
            })}
          </p>
        </div>
        <ScoreBadge score={displayScore(slot.score)} />
      </div>
    </li>
  )
}
