// DATA SOURCE PICKER
// Purpose: makes the mock or api data source depending on VITE_DATA_SOURCE

import { ApiDataSource } from "./ApiDataSource"
import type { clockType } from "./clock"
import type { DataSource } from "./DataSource"
import { MockDataSource } from "./mock/MockDataSource"

// mock or api from VITE_DATA_SOURCE, mock if its not set
export function dataSourceKind(): "mock" | "api" {
  return (import.meta.env.VITE_DATA_SOURCE ?? "mock").toLowerCase() === "api" ? "api" : "mock"
}

// clock drives the mock simulation, api mode ignores it
export function createDataSource(clock?: clockType): DataSource {
  if (dataSourceKind() === "api") {
    return new ApiDataSource(import.meta.env.VITE_API_URL ?? "http://localhost:8000")
  }
  return new MockDataSource(clock ? { now: clock.now } : {})
}
