// MOCK TRAFFIC MODEL
// Purpose: the traffic model and session generator for the mock data source
// sessions get made as movement (what the accelerometer would see), sets of continuous movement
// with rests in between plus the odd bump
// that movement goes through the real state machine (src/lib/stateMachine.ts) so every event follows
// the firmware rules, >= 3 s of movement to activate, RESTING -> AVAILABLE only after 5 min still, never ACTIVE -> AVAILABLE

import { isOpenAt, nextOpening } from "../../config/gym-hours"
import { RESTING_TIMEOUT_MS } from "../../config/state-machine"
import { MS_PER_MINUTE, MS_PER_SECOND } from "../../lib/time"
import { runStateMachine, type movement } from "../../lib/stateMachine"
import type { MachineKind, MachineState } from "../../types"

export type rngType = () => number

// small seeded PRNG (mulberry32) so the history comes out the same every time
export function mulberry32(seed: number): rngType {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// random helpers, all driven by the seeded rng
function uniform(rng: rngType, lo: number, hi: number) {
  return lo + rng() * (hi - lo)
}
function randInt(rng: rngType, lo: number, hi: number) {
  return Math.floor(uniform(rng, lo, hi + 1))
}
function exponential(rng: rngType, mean: number) {
  return -Math.log(1 - rng()) * mean
}

// traffic per hour of the day compared to the weekday evening peak (index = hour)
//   weekdays: quiet early and late, a small lunch bump, a big 5-7 pm peak
//   weekends: late morning is busiest
const WEEKDAY = [0, 0, 0, 0, 0, 0, 0.2, 0.36, 0.4, 0.28, 0.25, 0.32, 0.45, 0.38, 0.28, 0.35, 0.6, 1, 1, 0.78, 0.52, 0.3, 0.14, 0]
const WEEKEND = [0, 0, 0, 0, 0, 0, 0.05, 0.12, 0.28, 0.55, 0.85, 0.96, 0.88, 0.7, 0.55, 0.47, 0.42, 0.38, 0.34, 0.28, 0.2, 0.13, 0.06, 0]
// Mon..Sun multipliers, Friday evening is quieter than Mon-Thu (from 4 pm)
const DAY_FACTOR = [1.03, 1, 0.97, 0.99, 0.95, 0.96, 0.86]
const FRIDAY_EVENING = 0.8

// traffic 0..1 at a moment, compared to a weekday evening (0 = closed)
export function intensityAt(t: Date): number {
  if (!isOpenAt(t)) return 0
  const dow = (t.getDay() + 6) % 7
  const h = t.getHours()
  const profile = dow >= 5 ? WEEKEND : WEEKDAY
  return profile[h] * DAY_FACTOR[dow] * (dow === 4 && h >= 16 ? FRIDAY_EVENING : 1)
}

// deterministic hash -> [0, 1), for noise that cant depend on the RNG order
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x27d4eb2f, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

// week to week and day to day noise so the 4 weeks of history arent all the same
// each machines week is ±12 %, each day for the whole gym ±8 %
export function noiseAt(t: Date, machineIndex: number): number {
  const day = Math.floor((t.getTime() - t.getTimezoneOffset() * 60_000) / 86_400_000)
  const week = Math.floor((day + 3) / 7) // Monday-based week number
  return (0.88 + 0.24 * hash01(machineIndex + 1, week)) * (0.92 + 0.16 * hash01(9_973, day))
}

// most any machine is ever occupied
const MAX_OCCUPANCY = 0.9

// share of time a machine should be occupied at t = its peak popularity x the time of day profile x noise
export function targetOccupancy(t: Date, popularity: number, machineIndex: number): number {
  const k = intensityAt(t)
  if (k <= 0) return 0
  return Math.min(MAX_OCCUPANCY, k * popularity * noiseAt(t, machineIndex))
}

// average occupied time of one visit (workout + the final 5 min timeout), measured from planSession
const MEAN_OCCUPIED_MS = { weights: 15.5 * MS_PER_MINUTE, cardio: 33 * MS_PER_MINUTE }

export interface trafficProfile {
  index: number // index into the layout (for noise)
  popularity: number // peak occupancy on a weekday evening, 0..1
  cardio: boolean
}

// next time someone walks up to a machine that went free at from
// visits are a renewal process, with average occupied time O and target occupancy p
// the average idle gap is O·(1 − p)/p so over time the occupancy matches p
// the gap gets re-sampled every STEP to follow the changing target (its memoryless)
// nobody arrives while the gym is closed
export function nextArrival(from: number, machine: trafficProfile, rng: rngType): number {
  const STEP = 10 * MS_PER_MINUTE
  const occupied = machine.cardio ? MEAN_OCCUPIED_MS.cardio : MEAN_OCCUPIED_MS.weights
  let t = from
  for (let guard = 0; guard < 10_000; guard++) {
    if (!isOpenAt(t)) {
      t = nextOpening(t).getTime() + uniform(rng, 0, 10) * MS_PER_MINUTE
      continue
    }
    const p = targetOccupancy(new Date(t), machine.popularity, machine.index)
    if (p <= 0.005) {
      t += STEP
      continue
    }
    const gap = exponential(rng, (occupied * (1 - p)) / p)
    if (gap <= STEP) return t + gap
    t += STEP
  }
  return t
}

// peak (weekday 5-7 pm) occupancy per machine
// uneven on purpose so the heatmaps and owner dashboard actually show something,
// chest presses, lat pulldowns, the leg press and treadmills get fought over
// and the hip adductor, assisted dip and pull up barely get used
export const MACHINE_POPULARITY: Record<string, number> = {
  LE01: 0.84,
  LP01: 0.88,
  LC01: 0.8,
  SLC01: 0.78,
  HS01: 0.82,
  HAB01: 0.5,
  HAD01: 0.26,
  CR01: 0.6,
  SM01: 0.84,
  CP01: 0.88,
  CP02: 0.86,
  PD01: 0.82,
  ICP01: 0.84,
  CX01: 0.8,
  TP01: 0.82,
  AD01: 0.3,
  SP01: 0.84,
  LR01: 0.72,
  RD01: 0.42,
  LPD01: 0.88,
  LPD02: 0.86,
  SR01: 0.84,
  AP01: 0.28,
  TB01: 0.78,
  PC01: 0.7,
  BC01: 0.72,
  TM01: 0.88,
  TM02: 0.86,
  TM03: 0.84,
  TM04: 0.82,
  RW01: 0.62,
  RW02: 0.55,
  BK01: 0.76,
  EL01: 0.7,
}

// for machines added to the layout that dont have a tuned value yet
export const DEFAULT_POPULARITY = 0.6

export const CARDIO_KINDS: ReadonlySet<MachineKind> = new Set(["treadmill", "rower", "bike", "elliptical"])

export interface plannedEvent {
  state: MachineState
  at: number
}

// rest between sets, usually 1-3 min, sometimes longer, rarely past the timeout
function restMs(rng: rngType, cardio: boolean): number {
  const r = rng()
  // cardio, a short water break mid run
  if (cardio) return uniform(rng, 20, 90) * MS_PER_SECOND
  if (r < 0.88) return uniform(rng, 60, 180) * MS_PER_SECOND
  if (r < 0.98) return uniform(rng, 180, 260) * MS_PER_SECOND
  // walked off (phone, water) for longer than the timeout so the session ends
  return uniform(rng, 320, 480) * MS_PER_SECOND
}

// movement for one visit, maybe a bump while sitting down, then sets with rests
// and the odd seat / pin adjustment
export function planMovements(start: number, cardio: boolean, rng: rngType): movement[] {
  const out: movement[] = []
  let t = start
  function move(ms: number) {
    out.push({ start: Math.round(t), end: Math.round(t + ms) })
    t += ms
  }

  // sitting down / adjusting, a short bump under the activation time
  if (rng() < 0.3) {
    move(uniform(rng, 0.5, 2.5) * MS_PER_SECOND)
    t += uniform(rng, 8, 40) * MS_PER_SECOND
  }

  if (cardio) {
    // one 15-40 min run, sometimes split by a short water break
    const total = uniform(rng, 15, 40) * MS_PER_MINUTE
    if (rng() < 0.3) {
      const first = total * uniform(rng, 0.3, 0.7)
      move(first)
      t += restMs(rng, true)
      move(total - first)
    } else move(total)
    return out
  }

  // weights, 3-5 sets of 30-90 s with 1-3 min rests (≈ 8-20 min workout)
  const sets = randInt(rng, 3, 5)
  for (let i = 0; i < sets; i++) {
    move(uniform(rng, 30, 90) * MS_PER_SECOND)
    if (i === sets - 1) break
    const rest = restMs(rng, false)
    // adjusting the pin or seat part way through a rest, resets the timer
    if (rest < RESTING_TIMEOUT_MS && rng() < 0.1) {
      const before = rest * uniform(rng, 0.3, 0.7)
      t += before
      move(uniform(rng, 0.8, 2) * MS_PER_SECOND)
      t += rest - before
    } else {
      t += rest
    }
  }
  return out
}

// events for one visit, ending with AVAILABLE
export function planSession(start: number, cardio: boolean, rng: rngType): plannedEvent[] {
  return runStateMachine(planMovements(start, cardio, rng), undefined, { finish: true })
}

// the rest of the events after a machine gets put into a state mid session
// (demo controls, or a sensor coming back online)
export function planContinuation(state: MachineState, now: number, cardio: boolean, rng: rngType): plannedEvent[] {
  if (state === "AVAILABLE") return []
  if (state === "RESTING") {
    // half the time they do another set or two, otherwise theyve left
    const more = rng() < 0.5 ? planMovements(now + uniform(rng, 40, 150) * MS_PER_SECOND, cardio, rng).slice(-randInt(rng, 1, 2)) : []
    return runStateMachine(more, { state: "RESTING", since: now }, { finish: true })
  }
  // ACTIVE, the current set carries on then the rest of a short session
  const first: movement = { start: now, end: now + (cardio ? uniform(rng, 10, 30) * MS_PER_MINUTE : uniform(rng, 30, 70) * MS_PER_SECOND) }
  const rest = cardio ? [] : planMovements(first.end + restMs(rng, false), false, rng).slice(0, randInt(rng, 2, 4))
  return runStateMachine([first, ...rest], { state: "ACTIVE", since: now }, { finish: true })
}
