// UNTRACKED PANEL
// Purpose: the panel for free weights / stretching that explains why theres no data

import { EyeOff } from "lucide-react"
import { useEffect, useRef } from "react"
import { UNTRACKED_AREAS, UNTRACKED_MESSAGE, type fixtureKind } from "../config/gym-layout"

// shown when someone opens free weights or stretching on the map
export function UntrackedPanel({ kind, onClose }: { kind: fixtureKind; onClose: () => void }) {
  const info = UNTRACKED_AREAS[kind]
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [kind])
  if (!info) return null
  return (
    <section
      className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5"
      aria-labelledby="area-title"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg bg-stone-200 text-stone-600" aria-hidden="true">
            <EyeOff size={24} />
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Not tracked</p>
            <h2 id="area-title" ref={heading} tabIndex={-1} className="font-display text-3xl text-brown outline-none">
              {info.title}
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 rounded-full p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-2 focus-visible:outline-forest"
          aria-label="Close area panel"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="mx-4 my-4 rounded-lg bg-stone-100 px-3 py-3 text-sm text-stone-800">
        <p className="font-semibold">{UNTRACKED_MESSAGE}</p>
        <p className="mt-1 text-stone-600">{info.reason}</p>
      </div>
    </section>
  )
}
