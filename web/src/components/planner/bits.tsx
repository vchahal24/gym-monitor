// PLANNER BITS
// Purpose: small pieces the planner pages share

import { formatPercent } from "../../lib/format"

// chance free chip, shown with text and a bar not just colour
export function PFree({ name, p, noData = false }: { name: string; p: number; noData?: boolean }) {
  if (noData) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">
        {name} <span>not enough data yet</span>
      </span>
    )
  }
  let tone = "bg-[#FBE4E4] text-[#AE2C2C]"
  if (p >= 0.7) tone = "bg-[#E2F4E6] text-[#1B7234]"
  else if (p >= 0.45) tone = "bg-[#FCF3D2] text-[#7A5A00]"
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {name} <span className="tabular-nums">{formatPercent(p)}</span>
      <span className="sr-only">chance free</span>
    </span>
  )
}

// the 0-100 plan score
export function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="inline-flex flex-col items-center rounded-lg bg-forest px-2.5 py-1 text-cream" aria-label={`Score ${score} out of 100`}>
      <span className="font-display text-2xl leading-none">{score}</span>
      <span className="text-[10px] tracking-wide uppercase opacity-80">score</span>
    </span>
  )
}

// how busy the whole gym is in that slot, as a word as well as a number
export function GymBusy({ occupancy }: { occupancy: number }) {
  let label = "quiet"
  if (occupancy >= 0.6) label = "busy"
  else if (occupancy >= 0.35) label = "moderate"
  return (
    <span className="text-xs text-stone-600">
      Whole gym: <strong>{formatPercent(occupancy)}</strong> in use ({label})
    </span>
  )
}
