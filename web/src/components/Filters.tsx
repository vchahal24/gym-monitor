// FILTERS
// Purpose: the status legend / filter and machine type chips on the gym floor page

import { GROUP_LABELS, GROUP_STYLE, GYM_LAYOUT } from "../config/gym-layout"
import type { filterValue } from "../lib/filter"
import { EMPTY_FILTER } from "../lib/filter"
import { displayStatus } from "../lib/machine"
import { DISPLAY_STATUSES, MACHINE_GROUPS, type Machine } from "../types"
import { StateIcon } from "./StateIcon"
import { MAINTENANCE_HATCH, STATE_META } from "./stateMeta"

// groups this gyms layout actually has, always in the same order
const GROUPS = MACHINE_GROUPS.filter((g) => GYM_LAYOUT.some((m) => m.group === g))

// adds v if its not in the list, takes it out if it is
function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

// the state legend that doubles as a filter, plus machine type filter chips
export function Filters({ value, onChange, machines }: { value: filterValue; onChange: (v: filterValue) => void; machines: Machine[] }) {
  const counts = Object.fromEntries(DISPLAY_STATUSES.map((s) => [s, machines.filter((m) => displayStatus(m) === s).length]))
  const active = value.statuses.length > 0 || value.groups.length > 0

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="sr-only">Filter by status</legend>
        {DISPLAY_STATUSES.map((s) => {
          const meta = STATE_META[s]
          // offline only shows up in the legend while some node is quiet
          if (s === "OFFLINE" && counts[s] === 0 && !value.statuses.includes(s)) return null
          const on = value.statuses.includes(s)
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ ...value, statuses: toggle(value.statuses, s) })}
              className={`inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
                on ? "border-current" : "border-transparent hover:border-black/10"
              }`}
              style={{ backgroundColor: meta.tint, color: meta.text }}
            >
              <span
                className="inline-flex size-5 items-center justify-center rounded-full"
                style={{ backgroundColor: meta.color, backgroundImage: s === "MAINTENANCE" ? MAINTENANCE_HATCH : undefined, color: meta.onColor }}
              >
                <StateIcon state={s} size={12} />
              </span>
              {meta.label}
              <span className="tabular-nums opacity-80">{counts[s]}</span>
            </button>
          )
        })}
      </fieldset>

      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="sr-only">Filter by muscle group</legend>
        {GROUPS.map((t) => {
          const on = value.groups.includes(t)
          const style = GROUP_STYLE[t]
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ ...value, groups: toggle(value.groups, t) })}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
                on ? "border-forest bg-forest text-cream" : "bg-white text-stone-700 hover:border-forest/50"
              }`}
              style={on ? undefined : { borderColor: style.edge, backgroundColor: style.tint, color: style.ink }}
            >
              {GROUP_LABELS[t]}
            </button>
          )
        })}
      </fieldset>

      {active && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          className="text-sm font-medium text-forest-mid underline underline-offset-2 hover:text-forest"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
