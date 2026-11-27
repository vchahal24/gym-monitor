// REST PATTERN EDITOR
// Purpose: the chip strip for editing a rest pattern

import { ChevronLeft, ChevronRight, GripVertical, Minus, Plus, RotateCcw } from "lucide-react"
import { useState, type DragEvent } from "react"
import { cycleLength, type restPattern } from "../../lib/planner"

// workout 0 -> "A", 1 -> "B" ...
function letter(i: number) {
  return String.fromCharCode(65 + i)
}
const MAX_REST = 6

// edits a rest pattern as a strip, workout chip, rest chip, workout chip, ...
// workouts get reordered by dragging or with the arrow buttons, rest days change with − / +
// the running total says whether the cycle fits in a week
export function RestPatternEditor({ pattern, names, onChange }: { pattern: restPattern; names: string[]; onChange: (p: restPattern) => void }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const n = pattern.order.length
  const total = cycleLength(pattern)
  const restDays = total - n

  function move(from: number, to: number) {
    if (to < 0 || to >= n || from === to) return
    const order = [...pattern.order]
    const restAfter = [...pattern.restAfter]
    // a workouts rest days ("rest after B") move with it
    const [w] = order.splice(from, 1)
    const [r] = restAfter.splice(from, 1)
    order.splice(to, 0, w)
    restAfter.splice(to, 0, r)
    onChange({ order, restAfter })
  }
  function setRest(i: number, r: number) {
    return onChange({ order: pattern.order, restAfter: pattern.restAfter.map((x, j) => (j === i ? Math.max(0, Math.min(MAX_REST, r)) : x)) })
  }

  function onDrop(to: number) {
    return (e: DragEvent) => {
      e.preventDefault()
      if (dragFrom !== null) move(dragFrom, to)
      setDragFrom(null)
    }
  }

  return (
    <div>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Rest pattern, in cycle order">
        {pattern.order.map((w, i) => (
          <li key={w} className="contents">
            <div
              draggable
              onDragStart={(e) => {
                setDragFrom(i)
                e.dataTransfer.effectAllowed = "move"
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop(i)}
              onDragEnd={() => setDragFrom(null)}
              className={`flex items-center gap-0.5 rounded-lg bg-forest py-1 pr-1 pl-0.5 text-cream shadow-sm ${dragFrom === i ? "opacity-50" : ""}`}
              title={`Workout ${letter(w)}: ${names[w] ?? ""}. Drag to reorder.`}
            >
              <GripVertical size={14} className="cursor-grab opacity-60" aria-hidden />
              <button
                type="button"
                onClick={() => move(i, i - 1)}
                disabled={i === 0}
                className="rounded p-0.5 hover:bg-white/15 disabled:opacity-30"
                aria-label={`Move workout ${letter(w)} earlier`}
              >
                <ChevronLeft size={14} aria-hidden />
              </button>
              <span className="min-w-6 text-center font-display text-xl leading-none">{letter(w)}</span>
              <button
                type="button"
                onClick={() => move(i, i + 1)}
                disabled={i === n - 1}
                className="rounded p-0.5 hover:bg-white/15 disabled:opacity-30"
                aria-label={`Move workout ${letter(w)} later`}
              >
                <ChevronRight size={14} aria-hidden />
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-dashed border-stone-300 bg-white px-1 py-0.5 text-sm text-stone-700">
              <button
                type="button"
                onClick={() => setRest(i, pattern.restAfter[i] - 1)}
                disabled={pattern.restAfter[i] === 0}
                className="rounded p-0.5 hover:bg-stone-100 disabled:opacity-30"
                aria-label={`Fewer rest days after ${letter(w)}`}
              >
                <Minus size={13} aria-hidden />
              </button>
              <span className="flex items-center gap-0.5" aria-label={`${pattern.restAfter[i]} rest days after ${letter(w)}`}>
                {pattern.restAfter[i] === 0 ? (
                  <span className="px-0.5 text-xs font-semibold text-stone-500">no rest</span>
                ) : (
                  Array.from({ length: pattern.restAfter[i] }, (_, k) => <span key={k} className="size-2.5 rounded-sm bg-stone-300" aria-hidden />)
                )}
                {pattern.restAfter[i] > 0 && <span className="ml-1 text-xs font-semibold tabular-nums">{pattern.restAfter[i]}</span>}
              </span>
              <button
                type="button"
                onClick={() => setRest(i, pattern.restAfter[i] + 1)}
                disabled={pattern.restAfter[i] >= MAX_REST}
                className="rounded p-0.5 hover:bg-stone-100 disabled:opacity-30"
                aria-label={`More rest days after ${letter(w)}`}
              >
                <Plus size={13} aria-hidden />
              </button>
            </div>
          </li>
        ))}
        <li className="flex items-center gap-1 text-xs text-stone-500">
          <RotateCcw size={13} aria-hidden /> back to {letter(pattern.order[0] ?? 0)}
        </li>
      </ol>
      <p className="mt-2 text-sm text-stone-800" aria-live="polite">
        <strong>{n}</strong> workout{n === 1 ? "" : "s"} + <strong>{restDays}</strong> rest day{restDays === 1 ? "" : "s"} = <strong>{total}-day cycle</strong>{" "}
        {total === 7 ? (
          <span className="ml-1 rounded-full bg-[#E2F4E6] px-2 py-0.5 text-xs font-semibold text-[#1B7234]">repeats every week</span>
        ) : (
          <span className="ml-1 rounded-full bg-[#FCF3D2] px-2 py-0.5 text-xs font-semibold text-[#7A5A00]">drifts across weeks · planned over 4 weeks</span>
        )}
      </p>
    </div>
  )
}
