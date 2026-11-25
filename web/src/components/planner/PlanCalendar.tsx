// PLAN CALENDAR
// Purpose: the 4 week calendar for a rest pattern plan that drifts

import type { Plan } from "../../lib/planner"
import { DAY_LABELS, mondayIndex } from "../../lib/time"
import { slotTime } from "./format"

// 4 week calendar for a drifting rest pattern (cycle ≠ 7 days), weeks start on Monday
export function PlanCalendar({ plan }: { plan: Plan }) {
  const days = plan.calendar ?? []
  if (days.length === 0) return null
  const name = new Map(plan.workouts.map((w) => [w.workoutIndex, w.name]))
  const lead = mondayIndex(new Date(days[0].date))
  const cells = [...Array.from({ length: lead }, () => null), ...days]
  const today = days[0].date
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[300px] table-fixed border-separate border-spacing-0.5 text-center text-xs">
        <caption className="sr-only">Next 4 weeks: workout days with their time block, rest days blank</caption>
        <thead>
          <tr>
            {DAY_LABELS.map((d) => (
              <th key={d} scope="col" className="pb-1 font-bold text-stone-500">
                {d.slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.ceil(cells.length / 7) }, (_, r) => (
            <tr key={r}>
              {cells.slice(r * 7, r * 7 + 7).map((c, i) => {
                if (!c) return <td key={i} />
                const date = new Date(c.date)
                const label = `${date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}: ${
                  c.workoutIndex === null ? "rest" : `${name.get(c.workoutIndex)}${c.slot ? ` ${slotTime(c.slot)}` : ", no available slot"}`
                }`
                const tone =
                  c.workoutIndex === null
                    ? "bg-stone-50 text-stone-400"
                    : c.slot
                      ? "bg-forest text-cream"
                      : "bg-[#FBE4E4] text-[#AE2C2C] ring-1 ring-[#AE2C2C]/40"
                return (
                  <td
                    key={i}
                    title={label}
                    aria-label={label}
                    className={`h-12 rounded align-top ${tone} ${c.date === today ? "outline-2 outline-mustard" : ""}`}
                  >
                    <span className="block pt-0.5 text-[10px] opacity-80">{date.getDate()}</span>
                    {c.workoutIndex !== null && (
                      <>
                        <span className="block font-display text-base leading-none">{String.fromCharCode(65 + c.workoutIndex)}</span>
                        <span className="block text-[9px] leading-tight">{c.slot ? slotTime(c.slot) : "no slot"}</span>
                      </>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
