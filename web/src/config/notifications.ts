// NOTIFICATION CONFIG
// Purpose: thresholds for the admin notifications

// a machine is due for service after this many sessions since its last maintenance (or since records began)
// the mock keeps 4 weeks of history and the busiest machines get to ~700 in that
export const SERVICE_EVERY_SESSIONS = 710
export const HOLD_ALERT_HOURS = 2 // warn once an admin hold has pinned a machine for longer than this
