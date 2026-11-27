// REAL SENSOR NODES
// Purpose: settings for the real nodes in hybrid mode (VITE_DATA_SOURCE=hybrid)
// which machines are real comes from prototype: true in gym-layout.ts, the MAC mapping lives in bridge/machines.toml
// their timing comes from the bridge (/api/config, read from motion.h), never from here

import type { motionConfig } from "../types"

// hours of recorded real data before a real machine counts in rankings and the planner (lower it for a demo)
export const MIN_RECORDED_HOURS = 24

// reconnect backoff when the bridge cant be reached, doubles from first up to max
export const BRIDGE_RETRY_FIRST_MS = 1000
export const BRIDGE_RETRY_MAX_MS = 30_000

// how often recording hours and offline spans get refetched while connected
export const BRIDGE_REFRESH_MS = 60_000

// how long the first page load waits for the bridge before showing the real machines as offline
export const BRIDGE_FIRST_LOAD_WAIT_MS = 2500

// days of real events kept in the browser, same window as the 4 week history views
export const REAL_HISTORY_DAYS = 29

// only used until /api/config answers, a bridge that never answers leaves the real machines offline anyway
export const FALLBACK_MOTION_CONFIG: motionConfig = {
  restingTimeoutSeconds: 3,
  restingDelaySeconds: 0.4,
  thresholdG: 0.1,
  offlineAfterSeconds: 16,
  source: "default",
}
