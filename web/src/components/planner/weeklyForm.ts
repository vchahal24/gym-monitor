// WEEKLY FORM
// Purpose: the weekly planner form state and turning it into / out of a rest pattern

import { DAY_PRESETS, type restPattern } from "../../lib/planner"
import { BLOCKS, DAY_LABELS } from "../../lib/time"
import type { MachineKind } from "../../types"

export interface weeklyForm {
  count: number // workouts per week, 1–7.
  workouts: { name: string; kinds: MachineKind[] }[] // each workout is a list of machine kinds, the planner suggests the unit
  availability: boolean[][]
  restMode: "min" | "pattern" // min = simple "min rest days between workouts", pattern = custom rest pattern
  minRest: number
  patternOrder: number[] // rest pattern workout indices in cycle order (can have more than count, extras get ignored)
  restAfter: number[] // rest days after the workout at each cycle position
  sameTime: boolean
}

export const MAX_WORKOUTS = 7

export const DEFAULT_WEEKLY: weeklyForm = {
  count: 3,
  workouts: DAY_PRESETS.map((p) => ({ name: p.name, kinds: p.kinds })),
  availability: DAY_LABELS.map(() => BLOCKS.map(() => true)),
  restMode: "min",
  minRest: 1,
  // A → 1 → B → 1 → C → 2: a 7-day cycle for the default 3 workouts
  patternOrder: [0, 1, 2, 3, 4, 5, 6],
  restAfter: [1, 1, 2, 1, 1, 1, 1],
  sameTime: false,
}

// the pattern for the first count workouts, in the forms order
export function formPattern(form: weeklyForm): restPattern {
  const order = form.patternOrder.filter((i) => i < form.count)
  for (let i = 0; i < form.count; i++) if (!order.includes(i)) order.push(i)
  return { order, restAfter: order.map((_, i) => form.restAfter[i] ?? 1) }
}

// writes a pattern back, workouts past count stay at the end of the order
export function withPattern(form: weeklyForm, p: restPattern): weeklyForm {
  const rest = form.patternOrder.filter((i) => i >= form.count)
  const restAfter = [...p.restAfter, ...form.restAfter.slice(p.restAfter.length)]
  return { ...form, patternOrder: [...p.order, ...rest], restAfter }
}
