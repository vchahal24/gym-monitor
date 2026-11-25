// KIND PICKER
// Purpose: the searchable, grouped list of machine kinds with presets

import { Search, X } from "lucide-react"
import { useId, useState } from "react"
import { GROUP_LABELS, GROUP_STYLE } from "../../config/gym-layout"
import { kindPickerLabel, type plannerKind } from "../../lib/planner"
import { MACHINE_GROUPS, type MachineKind } from "../../types"
import { MachineIcon } from "../icons/MachineIcon"

// the kinds icon on a neutral square (a kind doesnt have one live status)
export function KindTile({ kind, size = 26, dim = false }: { kind: MachineKind; size?: number; dim?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md ${dim ? "bg-stone-300 text-stone-600" : "bg-forest text-cream"}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <MachineIcon kind={kind} size={Math.round(size * 0.82)} />
    </span>
  )
}

// searchable checklist of machine kinds by group, with one tap presets
// each one shows how many units there are and how many are in service
// a kind with no unit in service is disabled ("Out of service")
export function KindPicker({
  kinds,
  value,
  onChange,
  presets,
  compact = false,
}: {
  kinds: plannerKind[]
  value: MachineKind[]
  onChange: (kinds: MachineKind[]) => void
  presets: { name: string; kinds: MachineKind[] }[]
  compact?: boolean
}) {
  const [q, setQ] = useState("")
  const searchID = useId()
  const needle = q.trim().toLowerCase()
  function match(k: plannerKind) {
    return !needle || `${k.name} ${k.id} ${k.units.map((u) => `${u.id} ${u.name}`).join(" ")} ${GROUP_LABELS[k.group]}`.toLowerCase().includes(needle)
  }
  function toggle(id: MachineKind) {
    return onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  }
  const byID = new Map(kinds.map((k) => [k.id, k]))
  const picked = value.map((id) => byID.get(id)).filter((k): k is plannerKind => !!k)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-stone-600 uppercase">Presets</span>
        {presets.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => onChange(p.kinds)}
            className="rounded-full border border-forest/30 bg-white px-3 py-1 text-sm font-medium text-forest hover:bg-forest hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
          >
            {p.name}
          </button>
        ))}
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="ml-1 text-sm text-stone-600 underline underline-offset-2 hover:text-stone-900">
            Clear
          </button>
        )}
      </div>

      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Picked machines">
          {picked.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                onClick={() => toggle(k.id)}
                className={`inline-flex items-center gap-1.5 rounded-full py-1 pr-2 pl-1 text-sm ${
                  k.operational
                    ? "bg-forest text-cream hover:bg-forest-mid"
                    : "bg-stone-200 text-stone-700 line-through decoration-stone-500 hover:bg-stone-300"
                }`}
                aria-label={`Remove ${k.name}${k.operational ? "" : " (out of service)"}`}
              >
                <KindTile kind={k.id} size={22} dim={!k.operational} />
                {k.name}
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <label htmlFor={searchID} className="sr-only">
          Search machines
        </label>
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" aria-hidden />
        <input
          id={searchID}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search machines, e.g. press, row, treadmill"
          className="w-full rounded-lg border border-stone-300 bg-white py-2 pr-3 pl-9 text-sm focus:border-forest focus:outline-2 focus:outline-forest/30"
        />
      </div>

      <div className={`grid gap-3 overflow-y-auto pr-1 ${compact ? "max-h-72 sm:grid-cols-2" : "max-h-[28rem] sm:grid-cols-2 lg:grid-cols-1"}`}>
        {MACHINE_GROUPS.map((g) => {
          const list = kinds.filter((k) => k.group === g && match(k))
          if (list.length === 0) return null
          return (
            <fieldset key={g} className="rounded-lg p-2" style={{ backgroundColor: GROUP_STYLE[g].tint }}>
              <legend className="px-1 text-xs font-bold tracking-wide uppercase" style={{ color: GROUP_STYLE[g].ink }}>
                {GROUP_LABELS[g]}
              </legend>
              <ul className="space-y-1">
                {list.map((k) => {
                  const on = value.includes(k.id)
                  const { label, detail, disabled } = kindPickerLabel(k)
                  return (
                    <li key={k.id}>
                      <label
                        className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-sm ${
                          disabled ? "cursor-not-allowed text-stone-500" : "cursor-pointer hover:bg-white/70"
                        } ${on && !disabled ? "bg-white ring-1 ring-forest/40" : ""}`}
                        title={disabled ? "Every unit is in maintenance or offline" : k.units.map((u) => u.id).join(", ")}
                      >
                        <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={() => toggle(k.id)} className="size-4 accent-forest" />
                        <KindTile kind={k.id} dim={disabled} />
                        <span className="min-w-0 flex-1 truncate">
                          {label}
                          {detail && !disabled && <span className="text-stone-600"> ({detail})</span>}
                        </span>
                        {disabled && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-stone-700">
                            Out of service
                          </span>
                        )}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          )
        })}
      </div>
    </div>
  )
}
