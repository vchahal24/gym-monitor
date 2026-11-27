// SAVED PLANNER DATA
// Purpose: checks planner data read back from localStorage before we trust it
// picks and plans are stored by machine kind ("treadmill")
// anything from an older version (IDs like "M02", "L02" or even "TM01") or edited by hand
// gets cleaned or dropped instead of crashing the page

import type { Plan } from "./weekly"

// plain object, not an array or null
function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x)
}
// array of strings only
function isStrArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((s) => typeof s === "string")
}

// today picks, keeps only kinds we know (old machine IDs just get dropped)
export function cleanPicked<K extends string>(raw: unknown, known: ReadonlySet<K>): K[] {
  return isStrArray(raw) ? [...new Set(raw.filter((id): id is K => known.has(id as K)))] : []
}

export interface savedPlan {
  id: string
  savedAt: string
  plan: Plan
}

// every kind id a saved plan mentions, null if the plan isnt shaped right
function planIDs(plan: unknown): string[] | null {
  if (!isObj(plan) || !Array.isArray(plan.workouts)) return null
  const ids: string[] = []
  for (const w of plan.workouts) {
    if (!isObj(w) || !Array.isArray(w.kinds) || !isObj(w.slot)) return null
    for (const m of w.kinds) {
      if (!isObj(m) || typeof m.id !== "string") return null
      ids.push(m.id)
    }
  }
  return ids
}

// saved plans, one that mentions any unknown kind or is broken (for example saved by unit) is thrown out whole
export function cleanSavedPlans(raw: unknown, known: ReadonlySet<string>): { plans: savedPlan[]; dropped: number } {
  if (!Array.isArray(raw)) return { plans: [], dropped: 0 }
  const plans: savedPlan[] = []
  for (const s of raw) {
    const ids = isObj(s) && typeof s.id === "string" && typeof s.savedAt === "string" ? planIDs(s.plan) : null
    if (ids && ids.every((id) => known.has(id))) plans.push(s as unknown as savedPlan)
  }
  return { plans, dropped: raw.length - plans.length }
}

// weekly form, laid over the defaults field by field
// only keeps values with the right shape and kinds that still exist
export function cleanForm<K extends string, F extends { workouts: { name: string; kinds: K[] }[] }>(raw: unknown, defaults: F, known: ReadonlySet<K>): F {
  if (!isObj(raw)) return defaults
  const out: Record<string, unknown> = { ...defaults }
  for (const [k, def] of Object.entries(defaults)) {
    const v = raw[k]
    if (v === undefined) continue
    if (k === "workouts") {
      if (!Array.isArray(v)) continue
      out.workouts = defaults.workouts.map((dw, i) => {
        const w = v[i]
        if (!isObj(w)) return dw
        // an older version stored machine IDs under machineIds, so just use the template
        if (!isStrArray(w.kinds)) return dw
        const ids = cleanPicked(w.kinds, known)
        const kinds = w.kinds.length > 0 && ids.length === 0 ? dw.kinds : ids
        return { name: typeof w.name === "string" ? w.name : dw.name, kinds }
      })
    } else if (sameShape(v, def)) out[k] = v
  }
  return out as F
}

// checks v has the same shape as the default
//   1. primitives: same type
//   2. arrays: every element shaped like the defaults first one, grids (arrays of arrays) keep their size
//   3. objects: every key in the default is shaped right
export function sameShape(v: unknown, def: unknown): boolean {
  if (Array.isArray(def)) {
    if (!Array.isArray(v)) return false
    if (def.length === 0) return true
    if (Array.isArray(def[0]) && v.length !== def.length) return false
    return v.every((x, i) => sameShape(x, def[Array.isArray(def[0]) ? i : 0]))
  }
  if (isObj(def)) return isObj(v) && Object.keys(def).every((k) => sameShape(v[k], def[k]))
  return typeof v === typeof def
}
