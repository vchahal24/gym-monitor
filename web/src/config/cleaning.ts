// CLEANING CONFIG
// Purpose: cleaning thresholds and staffing assumptions for /admin/cleaning
// ASSUMPTION: these need tuning with the gym, they only drive notifications and suggestions

export interface cleaningThresholdType {
  sessions: number // sessions since the zone was last cleaned before we raise an alert
  occupiedMinutes: number // occupied machine minutes since the last clean before we raise an alert
}

// for any zone that doesnt have its own entry
export const DEFAULT_CLEANING_THRESHOLD: cleaningThresholdType = { sessions: 50, occupiedMinutes: 900 }

// per zone (Machine.zoneId), cardio sessions are long and sweaty so fewer of them trigger a wipe down
export const CLEANING_THRESHOLDS: Record<string, cleaningThresholdType> = {
  legs: { sessions: 50, occupiedMinutes: 900 },
  "chest-shoulders-triceps": { sessions: 50, occupiedMinutes: 900 },
  "back-biceps": { sessions: 45, occupiedMinutes: 800 },
  cardio: { sessions: 25, occupiedMinutes: 900 },
}

// the threshold for one zone
export function cleaningThreshold(zoneId: string): cleaningThresholdType {
  return CLEANING_THRESHOLDS[zoneId] ?? DEFAULT_CLEANING_THRESHOLD
}

export const MACHINE_HOURS_PER_CLEANER_HOUR = 30 // occupied machine hours one cleaner hour can keep up with (sizes the suggestions)
// suggested cleaner hours per visit get rounded to this step and kept in this range
export const CLEANER_HOURS_STEP = 0.5
export const CLEANER_HOURS_MIN = 0.5
export const CLEANER_HOURS_MAX = 3
export const DEEP_CLEANS_PER_WEEK = 2 // deep clean slots suggested per week
export const DEEP_CLEAN_HOURS = 2 // how long each one is
// longest gap (hours) between wipe downs while open, longer quiet stretches get an extra visit
export const MAX_HOURS_BETWEEN_CLEANS = 5
