// PLANNER PRESETS
// Purpose: the one tap machine picks and the weekly availability shortcuts

import type { MachineKind } from "../../types"

// presets are by machine kind, the planner picks the unit
// so Cardio means a treadmill and a rower, not TM01 specifically
export const TODAY_PRESETS: { name: string; kinds: MachineKind[] }[] = [
  { name: "Legs", kinds: ["leg-press", "hack-squat", "leg-extension", "leg-curl"] },
  { name: "Push", kinds: ["chest-press", "shoulder-press", "pec-deck", "triceps-pushdown"] },
  { name: "Shoulders", kinds: ["shoulder-press", "lateral-raise", "rear-delt"] },
  { name: "Pull", kinds: ["lat-pulldown", "seated-row", "t-bar-row", "biceps-curl"] },
  { name: "Cardio", kinds: ["treadmill", "rower"] },
]

// day templates for the weekly planner
export const DAY_PRESETS: { name: string; kinds: MachineKind[] }[] = [
  { name: "Day A: Legs", kinds: ["leg-press", "leg-extension", "treadmill"] },
  { name: "Day B: Push", kinds: ["chest-press", "shoulder-press", "triceps-pushdown"] },
  { name: "Day C: Pull", kinds: ["lat-pulldown", "seated-row", "preacher-curl"] },
  { name: "Day D: Cardio", kinds: ["treadmill", "rower", "bike"] },
  { name: "Day E: Full body", kinds: ["leg-press", "chest-press", "lat-pulldown"] },
  { name: "Day F: Arms", kinds: ["triceps-pushdown", "preacher-curl", "biceps-curl"] },
  { name: "Day G: Shoulders", kinds: ["shoulder-press", "lateral-raise", "rear-delt", "incline-press"] },
]

// availability shortcuts, test(day, block) says if that block is ticked
export const AVAILABILITY_PRESETS: { name: string; test: (day: number, block: number) => boolean }[] = [
  { name: "Any time", test: () => true },
  { name: "Weekday evenings only", test: (d, b) => d < 5 && b >= 5 },
  { name: "Mornings only", test: (_, b) => b <= 1 },
  { name: "Weekends only", test: (d) => d >= 5 },
  { name: "Lunchtimes", test: (d, b) => d < 5 && b === 2 },
]
