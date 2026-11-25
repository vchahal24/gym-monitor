// HEATMAP
// Purpose: the weekly day x block heatmap table

import { useRef, useState } from "react"
import { formatBlock, formatDay, formatPercent } from "../lib/format"
import { blockIndexAt, mondayIndex } from "../lib/time"
import type { Heatmap as HeatmapData } from "../types"

// one colour ramp from the brand greens (very light → forest)
const RAMP = ["#E3F1E6", "#B9DCC2", "#86C09A", "#4F9E6D", "#1E7A4C", "#0B4A2E"]
const STEP = 1 / RAMP.length

// which colour of the ramp a value gets
function binOf(v: number): number {
  return Math.min(RAMP.length - 1, Math.floor(v / STEP))
}

interface tipType {
  day: number
  block: number
  left: number
  top: number
}

// weekly heatmap laid out like Slide 7, MON-SUN columns and 2 hour block rows
// its a real table so screen readers get the day / block headers for each cell
// the current day header is highlighted and the current cell gets an outline
export function Heatmap({
  heatmap,
  now,
  caption,
  markBusiest = false,
  unit = "in use",
}: {
  heatmap: HeatmapData | undefined
  now: Date
  caption: string
  markBusiest?: boolean // label the busiest block in the grid
  unit?: string // what a value means, for example "in use" or "all busy at once"
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<tipType | null>(null)

  if (!heatmap) {
    return <div className="aspect-[8/5] w-full animate-pulse rounded-lg bg-heat-0/60" aria-busy="true" aria-label="Loading heatmap" />
  }

  const today = mondayIndex(now)
  const nowBlock = blockIndexAt(now)

  function show(day: number, block: number, el: HTMLElement) {
    const box = wrap.current?.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (!box) return
    setTip({ day, block, left: r.left - box.left + r.width / 2, top: r.top - box.top })
  }

  return (
    <div className="relative" ref={wrap} onMouseLeave={() => setTip(null)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] table-fixed border-separate border-spacing-[3px] text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <td className="w-[4.75rem] sm:w-24" />
              {heatmap.days.map((d, i) => (
                <th
                  key={d}
                  scope="col"
                  className={`rounded py-1.5 text-xs font-bold tracking-wide sm:text-sm ${i === today ? "bg-[#F2B5B5] text-brown" : "text-forest"}`}
                  aria-current={i === today ? "date" : undefined}
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.blocks.map((b, bi) => (
              <tr key={b}>
                <th scope="row" className="pr-2 text-left text-xs font-medium whitespace-nowrap text-stone-700 sm:text-sm">
                  {formatBlock(b)}
                </th>
                {heatmap.days.map((d, di) => {
                  const v = heatmap.values[di][bi]
                  const isNow = di === today && bi === nowBlock
                  const isPeak = markBusiest && heatmap.busiest.value > 0 && d === heatmap.busiest.day && b === heatmap.busiest.block
                  return (
                    <td
                      key={d}
                      tabIndex={0}
                      className="h-8 rounded-[3px] p-0 align-middle outline-none focus-visible:ring-3 focus-visible:ring-mustard sm:h-10"
                      style={{
                        backgroundColor: RAMP[binOf(v)],
                        boxShadow: isNow ? "inset 0 0 0 2.5px #C62828" : undefined,
                      }}
                      onMouseEnter={(e) => show(di, bi, e.currentTarget)}
                      onFocus={(e) => show(di, bi, e.currentTarget)}
                      onBlur={() => setTip(null)}
                    >
                      {isPeak && (
                        <span
                          className="block text-center text-[10px] font-bold tracking-wide sm:text-xs"
                          style={{ color: binOf(v) >= 3 ? "#FBF7EF" : "#0B4A2E" }}
                          aria-hidden="true"
                        >
                          PEAK
                        </span>
                      )}
                      <span className="sr-only">
                        {formatPercent(v)} {unit}
                        {isNow ? " (now)" : ""}
                        {isPeak ? " (busiest)" : ""}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-stone-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lg"
          style={{ left: tip.left, top: tip.top - 6 }}
        >
          <div className="font-semibold">
            {formatDay(heatmap.days[tip.day])} {formatBlock(heatmap.blocks[tip.block])}
          </div>
          <div>
            {formatPercent(heatmap.values[tip.day][tip.block])} of the block {unit}
          </div>
        </div>
      )}

      <HeatmapLegend weeks={heatmap.weeks} unit={unit} />
    </div>
  )
}

// the colour key under the heatmap
function HeatmapLegend({ weeks, unit }: { weeks: number; unit: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-stone-600">
      <div className="flex items-center gap-2" aria-hidden="true">
        <span>0%</span>
        <div className="flex gap-0.5">
          {RAMP.map((c) => (
            <span key={c} className="h-3 w-6 rounded-sm" style={{ backgroundColor: c }} />
          ))}
        </div>
        <span>100% {unit}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 rounded-sm bg-heat-0" style={{ boxShadow: "inset 0 0 0 2px #C62828" }} aria-hidden="true" />
          Now
        </span>
        <span>Average of the last {weeks} weeks</span>
      </div>
    </div>
  )
}
