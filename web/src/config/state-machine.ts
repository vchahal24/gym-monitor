// STATE MACHINE TIMING
// Purpose: the sensor node state machine timings (docs/DATA_CONTRACT.md §0)
// IMPORTANT: these MUST match the ESP32 firmware in ../esp32-node/
// the mock simulation, session derivation and the RESTING countdown in the UI all assume them
// so if the firmware changes, change them here too
//   AVAILABLE → ACTIVE     continuous movement for ≥ ACTIVATION_SECONDS
//   ACTIVE    → RESTING    movement stops
//   RESTING   → ACTIVE     any movement, the resting timer resets to 0
//   RESTING   → AVAILABLE  no movement for RESTING_TIMEOUT_SECONDS straight
//   ACTIVE    → AVAILABLE  never

// NOTE: still need to check these against the firmware once its state machine is written
export const ACTIVATION_SECONDS = 3
export const RESTING_TIMEOUT_SECONDS = 300

export const ACTIVATION_MS = ACTIVATION_SECONDS * 1000
export const RESTING_TIMEOUT_MS = RESTING_TIMEOUT_SECONDS * 1000
