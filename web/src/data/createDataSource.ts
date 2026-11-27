// DATA SOURCE PICKER
// Purpose: makes the mock, api or hybrid data source depending on VITE_DATA_SOURCE

import { ApiDataSource } from "./ApiDataSource"
import type { clockType } from "./clock"
import type { DataSource } from "./DataSource"
import { HybridDataSource } from "./hybrid/HybridDataSource"
import { MockDataSource } from "./mock/MockDataSource"

// mock, api or hybrid from VITE_DATA_SOURCE, mock if its not set (or not one of those)
export function dataSourceKind(): "mock" | "api" | "hybrid" {
  const kind = (import.meta.env.VITE_DATA_SOURCE ?? "mock").toLowerCase()
  return kind === "api" || kind === "hybrid" ? kind : "mock"
}

// true when the demos sim clock drives (part of) the data
export function usesSimClock(): boolean {
  return dataSourceKind() !== "api"
}

// clock drives the mock simulation (all of it in mock mode, the simulated machines in hybrid mode), api mode ignores it
export function createDataSource(clock?: clockType): DataSource {
  const apiURL = import.meta.env.VITE_API_URL ?? "http://localhost:8000"
  const kind = dataSourceKind()
  if (kind === "api") return new ApiDataSource(apiURL)
  if (kind === "hybrid") return new HybridDataSource({ apiURL, ...(clock ? { now: clock.now } : {}) })
  return new MockDataSource(clock ? { now: clock.now } : {})
}
