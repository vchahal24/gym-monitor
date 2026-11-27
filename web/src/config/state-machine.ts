// STATE MACHINE TIMING
// Purpose: the sensor node state machine timings (docs/DATA_CONTRACT.md §0)
// these are the timings of the SIMULATED machines (the mock and the 29 simulated machines in hybrid mode)
// the real nodes (LE01, LP01) follow hardware/include/motion.h, which the bridge serves at /api/config,
// so the firmware can change without touching this file (both side by side in docs/DATA_CONTRACT.md §0)
//   AVAILABLE → ACTIVE     continuous movement for ≥ ACTIVATION_SECONDS
//   ACTIVE    → RESTING    movement stops
//   RESTING   → ACTIVE     any movement, the resting timer resets to 0
//   RESTING   → AVAILABLE  no movement for RESTING_TIMEOUT_SECONDS straight
//   ACTIVE    → AVAILABLE  never

export const ACTIVATION_SECONDS = 3
export const RESTING_TIMEOUT_SECONDS = 300

export const ACTIVATION_MS = ACTIVATION_SECONDS * 1000
export const RESTING_TIMEOUT_MS = RESTING_TIMEOUT_SECONDS * 1000
