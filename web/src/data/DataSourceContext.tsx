// DATA SOURCE PROVIDER
// Purpose: makes the data source, live store and clock once and hands them to the app, plus the demo reset

import { Fragment, useEffect, useState, type ReactNode } from "react"
import { realClock, simClockClass } from "./clock"
import { DataContext, type dataContextValue } from "./context"
import { LiveStore } from "./LiveStore"
import { createDataSource, usesSimClock } from "./createDataSource"

// a data source + live store on the given clock (real time if theres no sim clock)
function build(simClock: simClockClass | undefined): Omit<dataContextValue, "reset"> {
  const clock = simClock ?? realClock
  const ds = createDataSource(clock)
  return { ds, store: new LiveStore(ds, clock.now), clock, simClock }
}

// made once per page load so React StrictMode mounting twice doesnt restart the simulation
let singleton: { value: Omit<dataContextValue, "reset">; generation: number } | null = null
function getDefault() {
  if (!singleton) singleton = { value: build(usesSimClock() ? new simClockClass() : undefined), generation: 0 }
  return singleton
}

export function DataSourceProvider({ children, value }: { children: ReactNode; value?: dataContextValue }) {
  const [state, setState] = useState(() => (value ? { value, generation: 0 } : getDefault()))
  const ctx: dataContextValue = value ?? {
    ...state.value,
    reset: state.value.simClock
      ? () => {
          const old = state.value
          old.simClock!.reset()
          old.ds.dispose()
          singleton = { value: build(old.simClock), generation: state.generation + 1 }
          setState(singleton)
        }
      : undefined,
  }
  useEffect(() => {
    state.value.store.start()
    return () => state.value.store.stop()
  }, [state])
  // a reset remounts everything below so no component keeps data from the old simulation
  return (
    <DataContext.Provider value={ctx}>
      <Fragment key={state.generation}>{children}</Fragment>
    </DataContext.Provider>
  )
}
