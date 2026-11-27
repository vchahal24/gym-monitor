// GYM LAYOUT
// Purpose: the physical layout of the gym floor, every machine, zone and fixture with its spot on the map
// adding a new sensor node = adding one entry to GYM_LAYOUT
// coordinates are floor plan units (see FLOOR) from the top left corner, and give the middle of the machines tile

import type { MachineGroup, MachineKind } from "../types"

// how the floor is laid out and why
//   1. the bottom of the plan is the front of the building, a glass street front (the window wall) with the entrance in it
//   2. front band (bottom): you walk in past the front desk
//      the change rooms are in the corner right next to the entrance so nobody crosses the floor in street shoes
//      cardio runs along the window wall, treadmills in the front row facing the windows, rowers / bike / elliptical behind
//      cardio is where most people warm up, its the first thing you get to and the front desk can see all of it
//   3. stretching is between the desk and cardio so its on the way in (warm up) and on the way out (cool down)
//   4. back band (top): the strength zones, left to right Legs · Free weights · Chest, Shoulders & Triceps · Back & Biceps
//      free weights are between Legs and Chest/Shoulders because both use them (squats/lunges, presses/raises),
//      with the water fountain in the walkway just below
//   5. machines of the same kind stand next to each other (the 4 treadmills in one row, the 2 chest presses
//      side by side, both lat pulldowns together)
//   6. inside each strength zone machines go in the order a workout does, row by row, compound first then isolation
//        Legs: Smith → Hack squat → Leg press / Leg extension → Lying & seated curl / Hip abductor & adductor → Calf raise
//        Chest, Shoulders & Triceps: chest presses → pec deck & crossover / shoulder press → lateral raise → rear delt /
//          assisted dip → pushdown
//        Back & Biceps: lat pulldowns → assisted pull-up / T-bar & cable row / preacher & biceps curl
//   7. a clear walkway (about 1.7 m) runs between the strength and front bands, with ~85 cm aisles between zones
//      tiles never overlap and labels stay under one machine pitch wide
//
// machine IDs = kind code + 2 digit unit number (TM01-TM04 are the 4 treadmills)
// codes are unique per kind (LP leg press vs LPD lat pulldown, LC lying curl vs SLC seated curl, HAB abductor vs HAD adductor)
// LE01 and LP01 are the two prototype nodes
export interface machineLayout {
  id: string
  name: string // full name, for example "Seated Leg Press"
  label: string // short label drawn under the tile on the map
  group: MachineGroup
  kind: MachineKind
  zoneId?: string // floor zone the machine is in (for the cleaning load), defaults to its group
  x: number
  y: number
  prototype?: boolean // a real ESP32 + XBee sensor node (shows a "live sensor" badge)
}

export interface rect {
  x: number
  y: number
  width: number
  height: number
}

export interface floorZone extends rect {
  id: string // zone id, used for the cleaning load (Machine.zoneId), same as the group for machine zones
  group: MachineGroup
  label: string
}

export type fixtureKind = "free-weights" | "change-room" | "front-desk" | "water" | "stretching"

// things on the floor that arent machines
// free weights and stretching are untracked areas, you can click them but they explain we cant collect data there
// the rest are just drawn so people can find their way
export interface floorFixture extends rect {
  kind: fixtureKind
  label: string
}

// areas people can click that have no sensors, and why
export const UNTRACKED_AREAS: Partial<Record<fixtureKind, { title: string; reason: string }>> = {
  "free-weights": {
    title: "Free weights",
    reason: "Dumbbells and barbells move around the room and have no fixed moving part to put an accelerometer on.",
  },
  stretching: {
    title: "Stretching area",
    reason: "Mats get moved and stretching barely moves anything, so an accelerometer has nothing reliable to measure.",
  },
}

export const UNTRACKED_MESSAGE = "This area can't be tracked reliably, so no data is shown."

// true for free weights / stretching
export function isUntracked(kind: fixtureKind): boolean {
  return kind in UNTRACKED_AREAS
}

// floor plan is 1240 × 890 units (about 31 m × 22 m at 2.5 cm per unit)
export const FLOOR = { width: 1240, height: 890 } as const

// machine tile size on the map
export const TILE = 76

// windows along the bottom (street front) wall, the treadmill row faces them
export const WINDOWS: { x: number; width: number }[] = [
  { x: 350, width: 150 },
  { x: 530, width: 150 },
  { x: 705, width: 150 },
  { x: 880, width: 150 },
  { x: 1055, width: 150 },
]

// the entrance, drawn as a gap in the bottom wall
export const ENTRANCE = { x: 206, width: 124 } as const

// strength band, 3 + 3 + 2 machine columns 104 units apart, rows 118 apart
const LEGS_X = [84, 188, 292]
const CST_X = [690, 794, 898]
const BB_X = [1052, 1156]
const ROW = [102, 220, 338, 456]
// cardio, two rows of 4 in the front band with the treadmills nearest the windows
const CARDIO_X = [604, 779, 954, 1129]
const CARDIO_BACK_Y = 680
const CARDIO_FRONT_Y = 790

export const FLOOR_ZONES: floorZone[] = [
  { id: "legs", group: "legs", label: "Legs", x: 24, y: 24, width: 328, height: 380 },
  { id: "chest-shoulders-triceps", group: "chest-shoulders-triceps", label: "Chest, Shoulders & Triceps", x: 630, y: 24, width: 328, height: 498 },
  { id: "back-biceps", group: "back-biceps", label: "Back & Biceps", x: 992, y: 24, width: 224, height: 498 },
  { id: "cardio", group: "cardio", label: "Cardio · window side", x: 516, y: 600, width: 700, height: 266 },
]

export const FLOOR_FIXTURES: floorFixture[] = [
  { kind: "free-weights", label: "Free weights", x: 386, y: 24, width: 210, height: 498 },
  { kind: "water", label: "Water", x: 410, y: 536, width: 40, height: 40 },
  { kind: "stretching", label: "Stretching", x: 346, y: 610, width: 150, height: 170 },
  { kind: "front-desk", label: "Front desk", x: 346, y: 816, width: 150, height: 44 },
  { kind: "change-room", label: "Change room", x: 24, y: 610, width: 166, height: 122 },
  { kind: "change-room", label: "Change room", x: 24, y: 740, width: 166, height: 122 },
]

type entry = Omit<machineLayout, "group">

// a zones machines, all given the same group
function zone(group: MachineGroup, entries: entry[]): machineLayout[] {
  return entries.map((e) => ({ ...e, group }))
}

export const GYM_LAYOUT: machineLayout[] = [
  // legs: compound (Smith, hack squat, leg press) → knee isolation → hips → calves
  ...zone("legs", [
    { id: "SM01", name: "Smith Machine", label: "Smith", kind: "smith-machine", x: LEGS_X[0], y: ROW[0] },
    { id: "HS01", name: "Hack Squat", label: "Hack Squat", kind: "hack-squat", x: LEGS_X[1], y: ROW[0] },
    { id: "LP01", name: "Seated Leg Press", label: "Leg Press", kind: "leg-press", x: LEGS_X[2], y: ROW[0], prototype: true },
    { id: "LE01", name: "Leg Extension", label: "Leg Extension", kind: "leg-extension", x: LEGS_X[0], y: ROW[1], prototype: true },
    { id: "LC01", name: "Lying Leg Curl", label: "Lying Curl", kind: "leg-curl", x: LEGS_X[1], y: ROW[1] },
    { id: "SLC01", name: "Seated Leg Curl", label: "Seated Curl", kind: "leg-curl", x: LEGS_X[2], y: ROW[1] },
    { id: "HAB01", name: "Hip Abductor", label: "Abductor", kind: "hip-abductor", x: LEGS_X[0], y: ROW[2] },
    { id: "HAD01", name: "Hip Adductor", label: "Adductor", kind: "hip-adductor", x: LEGS_X[1], y: ROW[2] },
    { id: "CR01", name: "Calf Raise", label: "Calf Raise", kind: "calf-raise", x: LEGS_X[2], y: ROW[2] },
  ]),

  // chest, shoulders & triceps: one row per muscle, compound first
  ...zone("chest-shoulders-triceps", [
    { id: "CP01", name: "Chest Press 1", label: "Chest Press 1", kind: "chest-press", x: CST_X[0], y: ROW[0] },
    { id: "CP02", name: "Chest Press 2", label: "Chest Press 2", kind: "chest-press", x: CST_X[1], y: ROW[0] },
    { id: "ICP01", name: "Incline Chest Press", label: "Incline Press", kind: "incline-press", x: CST_X[2], y: ROW[0] },
    { id: "PD01", name: "Pec Deck", label: "Pec Deck", kind: "pec-deck", x: CST_X[0], y: ROW[1] },
    { id: "CX01", name: "Cable Crossover", label: "Crossover", kind: "cable-crossover", x: CST_X[1], y: ROW[1] },
    { id: "SP01", name: "Shoulder Press", label: "Shoulder Press", kind: "shoulder-press", x: CST_X[0], y: ROW[2] },
    { id: "LR01", name: "Lateral Raise Machine", label: "Lateral Raise", kind: "lateral-raise", x: CST_X[1], y: ROW[2] },
    { id: "RD01", name: "Rear Delt Machine", label: "Rear Delt", kind: "rear-delt", x: CST_X[2], y: ROW[2] },
    { id: "AD01", name: "Assisted Dip", label: "Assisted Dip", kind: "assisted-dip", x: CST_X[0], y: ROW[3] },
    { id: "TP01", name: "Triceps Pushdown Station", label: "Pushdown", kind: "triceps-pushdown", x: CST_X[1], y: ROW[3] },
  ]),

  // back & biceps: vertical pulls → horizontal rows → biceps
  ...zone("back-biceps", [
    { id: "LPD01", name: "Lat Pulldown 1", label: "Pulldown 1", kind: "lat-pulldown", x: BB_X[0], y: ROW[0] },
    { id: "LPD02", name: "Lat Pulldown 2", label: "Pulldown 2", kind: "lat-pulldown", x: BB_X[1], y: ROW[0] },
    { id: "AP01", name: "Assisted Pull-up", label: "Asst. Pull-up", kind: "assisted-pullup", x: BB_X[0], y: ROW[1] },
    { id: "TB01", name: "T-Bar Row", label: "T-Bar Row", kind: "t-bar-row", x: BB_X[0], y: ROW[2] },
    { id: "SR01", name: "Seated Cable Row", label: "Cable Row", kind: "seated-row", x: BB_X[1], y: ROW[2] },
    { id: "PC01", name: "Preacher Curl", label: "Preacher Curl", kind: "preacher-curl", x: BB_X[0], y: ROW[3] },
    { id: "BC01", name: "Biceps Curl Machine", label: "Biceps Curl", kind: "biceps-curl", x: BB_X[1], y: ROW[3] },
  ]),

  // cardio along the windows: treadmills in front, the rest behind
  ...zone("cardio", [
    { id: "RW01", name: "Rowing Machine 1", label: "Rower 1", kind: "rower", x: CARDIO_X[0], y: CARDIO_BACK_Y },
    { id: "RW02", name: "Rowing Machine 2", label: "Rower 2", kind: "rower", x: CARDIO_X[1], y: CARDIO_BACK_Y },
    { id: "BK01", name: "Upright Bike", label: "Upright Bike", kind: "bike", x: CARDIO_X[2], y: CARDIO_BACK_Y },
    { id: "EL01", name: "Elliptical", label: "Elliptical", kind: "elliptical", x: CARDIO_X[3], y: CARDIO_BACK_Y },
    { id: "TM01", name: "Treadmill 1", label: "Treadmill 1", kind: "treadmill", x: CARDIO_X[0], y: CARDIO_FRONT_Y },
    { id: "TM02", name: "Treadmill 2", label: "Treadmill 2", kind: "treadmill", x: CARDIO_X[1], y: CARDIO_FRONT_Y },
    { id: "TM03", name: "Treadmill 3", label: "Treadmill 3", kind: "treadmill", x: CARDIO_X[2], y: CARDIO_FRONT_Y },
    { id: "TM04", name: "Treadmill 4", label: "Treadmill 4", kind: "treadmill", x: CARDIO_X[3], y: CARDIO_FRONT_Y },
  ]),
]

// round 3 muscle based IDs → current IDs
const ROUND3_IDS: Record<string, string> = {
  L01: "LE01",
  L02: "LP01",
  L03: "LC01",
  L04: "SLC01",
  L05: "HS01",
  L06: "HAB01",
  L07: "HAD01",
  L08: "CR01",
  L09: "SM01",
  CH01: "CP01",
  CH02: "CP02",
  CH03: "PD01",
  CH04: "ICP01",
  CH05: "CX01",
  S01: "SP01",
  S02: "LR01",
  S03: "RD01",
  T01: "TP01",
  T02: "AD01",
  BA01: "LPD01",
  BA02: "LPD02",
  BA03: "SR01",
  BA04: "AP01",
  BA05: "TB01",
  BI01: "PC01",
  BI02: "BC01",
  CA01: "TM01",
  CA02: "TM02",
  CA03: "TM03",
  CA04: "TM04",
  CA05: "RW01",
  CA06: "RW02",
  CA07: "BK01",
  CA08: "EL01",
}

// round 1-2 IDs → round 3 IDs
const ROUND2_IDS: Record<string, string> = {
  M01: "L01",
  M02: "L02",
  M03: "L03",
  M04: "L04",
  M05: "L05",
  M06: "L06",
  M07: "L07",
  M08: "L08",
  M09: "L09",
  M10: "CH01",
  M11: "CH02",
  M12: "CH03",
  M13: "CH04",
  M14: "CH05",
  M15: "T01",
  M16: "T02",
  M17: "BA01",
  M18: "BA02",
  M19: "BA03",
  M20: "BA04",
  M21: "BA05",
  M22: "BI01",
  M23: "BI02",
  M24: "CA01",
  M25: "CA02",
  M26: "CA03",
  M27: "CA04",
  M28: "CA05",
  M29: "CA06",
  M30: "CA07",
  M31: "CA08",
}

// every old ID (round 1-2 M02, round 3 L02) → its current ID
// so old links like /machine/M02 or /machine/L02 still go to the right machine
export const LEGACY_IDS: Record<string, string> = {
  ...ROUND3_IDS,
  ...Object.fromEntries(Object.entries(ROUND2_IDS).map(([old, mid]) => [old, ROUND3_IDS[mid]])),
}

// which zone a machine is in (for the cleaning load)
export function zoneOf(m: Pick<machineLayout, "zoneId" | "group">): string {
  return m.zoneId ?? m.group
}

export const GROUP_LABELS: Record<MachineGroup, string> = {
  legs: "Legs",
  "chest-shoulders-triceps": "Chest, Shoulders & Triceps",
  "back-biceps": "Back & Biceps",
  cardio: "Cardio",
}

// light zone tints and a darker ink per group (chosen to stay clear of the state colours)
export const GROUP_STYLE: Record<MachineGroup, { tint: string; edge: string; ink: string }> = {
  legs: { tint: "#EAF1FA", edge: "#C9D9EE", ink: "#33557F" },
  "chest-shoulders-triceps": { tint: "#F2EDF8", edge: "#DCD0EC", ink: "#5B4482" },
  "back-biceps": { tint: "#E6F3F1", edge: "#C4E0DB", ink: "#2F6A61" },
  cardio: { tint: "#F6F0E3", edge: "#E4D8BE", ink: "#7A5E2C" },
}

export const KIND_LABELS: Record<MachineKind, string> = {
  "leg-extension": "Leg extension",
  "leg-press": "Leg press",
  "leg-curl": "Leg curl",
  "hack-squat": "Hack squat",
  "hip-abductor": "Hip abductor",
  "hip-adductor": "Hip adductor",
  "calf-raise": "Calf raise",
  "smith-machine": "Smith machine",
  "chest-press": "Chest press",
  "pec-deck": "Pec deck",
  "incline-press": "Incline press",
  "cable-crossover": "Cable crossover",
  "triceps-pushdown": "Triceps pushdown",
  "assisted-dip": "Assisted dip",
  "shoulder-press": "Shoulder press",
  "lateral-raise": "Lateral raise",
  "rear-delt": "Rear delt",
  "lat-pulldown": "Lat pulldown",
  "seated-row": "Seated row",
  "assisted-pullup": "Assisted pull-up",
  "t-bar-row": "T-bar row",
  "preacher-curl": "Preacher curl",
  "biceps-curl": "Biceps curl",
  treadmill: "Treadmill",
  rower: "Rowing machine",
  bike: "Upright bike",
  elliptical: "Elliptical",
}

// kinds that train roughly the same thing, closest first
// when every unit of a kind is out of service the planner swaps in one of these before any other kind in the group
export const SIMILAR_KINDS: Partial<Record<MachineKind, MachineKind[]>> = {
  "leg-press": ["hack-squat", "smith-machine"],
  "hack-squat": ["leg-press", "smith-machine"],
  "smith-machine": ["hack-squat", "leg-press"],
  "leg-extension": ["leg-press", "hack-squat"],
  "leg-curl": ["leg-extension"],
  "hip-abductor": ["hip-adductor"],
  "hip-adductor": ["hip-abductor"],
  "calf-raise": ["leg-press", "smith-machine"],
  "chest-press": ["incline-press", "pec-deck"],
  "incline-press": ["chest-press", "shoulder-press"],
  "pec-deck": ["cable-crossover", "chest-press"],
  "cable-crossover": ["pec-deck", "chest-press"],
  "shoulder-press": ["incline-press", "lateral-raise"],
  "lateral-raise": ["shoulder-press", "cable-crossover"],
  "rear-delt": ["pec-deck", "lateral-raise"],
  "triceps-pushdown": ["assisted-dip"],
  "assisted-dip": ["triceps-pushdown", "chest-press"],
  "lat-pulldown": ["assisted-pullup", "seated-row"],
  "assisted-pullup": ["lat-pulldown"],
  "seated-row": ["t-bar-row", "lat-pulldown"],
  "t-bar-row": ["seated-row"],
  "preacher-curl": ["biceps-curl"],
  "biceps-curl": ["preacher-curl"],
  treadmill: ["elliptical", "bike"],
  elliptical: ["treadmill", "bike"],
  bike: ["elliptical", "rower"],
  rower: ["elliptical", "bike"],
}

// plural kind label for counts ("Treadmills", "Chest presses")
export function kindPlural(kind: MachineKind): string {
  const l = KIND_LABELS[kind]
  return /(s|sh|ch|x)$/.test(l) ? `${l}es` : `${l}s`
}

// the layout entry for one machine id
export function getMachineLayout(id: string): machineLayout | undefined {
  return GYM_LAYOUT.find((m) => m.id === id)
}
