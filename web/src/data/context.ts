// DATA CONTEXT
// Purpose: the React context every hook gets the data source, live store and clock from

import { createContext } from "react"
import type { DataSource } from "./DataSource"
import type { LiveStore } from "./LiveStore"
import type { clockType, simClockClass } from "./clock"

export interface dataContextValue {
  ds: DataSource
  store: LiveStore
  clock: clockType // time for data and timers (the demos sim clock in mock mode)
  simClock?: simClockClass // mock mode only, the sim clock the demo panel controls
  reset?: () => void // mock mode only, throws away the simulation and starts a fresh one
}

export const DataContext = createContext<dataContextValue | null>(null)
