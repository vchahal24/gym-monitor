// INTERNAL HOOK HELPERS
// Purpose: context access, the live snapshot and a small fetch / debounce helper the data hooks share

import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { DataContext, type dataContextValue } from "../data/context"
import type { liveSnapshot } from "../data/LiveStore"

// the data context, throws if theres no provider above
export function useDataContext(): dataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error("Data hooks must be used inside <DataSourceProvider>")
  return ctx
}

// the live store snapshot, re-renders when it changes
export function useLiveSnapshot(): liveSnapshot {
  const { store } = useDataContext()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

export interface fetchState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean // true while the first load for the current key is in flight
}

// runs fetcher whenever key changes (null = dont fetch)
// keeps the last data while a refetch is going so the UI doesnt flash
export function useFetch<T>(key: string | null, fetcher: () => Promise<T>): fetchState<T> {
  const ref = useRef(fetcher)
  useEffect(() => {
    ref.current = fetcher
  })
  const [state, setState] = useState<{ key: string | null; data?: T; error?: Error; dataKey?: string }>({ key: null })

  useEffect(() => {
    if (key === null) return
    let cancelled = false
    ref.current().then(
      (data) => !cancelled && setState({ key, data, dataKey: key.split("#")[0] }),
      (error: unknown) => !cancelled && setState((s) => ({ ...s, key, error: error instanceof Error ? error : new Error(String(error)) })),
    )
    return () => {
      cancelled = true
    }
  }, [key])

  // data is reused across refreshes of the same base key ("id#revision")
  const base = key?.split("#")[0]
  const usable = state.dataKey === base ? state.data : undefined
  return { data: usable, error: state.key === key ? state.error : undefined, loading: usable === undefined && !state.error }
}

// debounces a changing value (used to batch refetches after live events)
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
