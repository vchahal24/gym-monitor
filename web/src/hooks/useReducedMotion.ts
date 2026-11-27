// USE REDUCED MOTION
// Purpose: follows the prefers-reduced-motion setting so animations can switch off

import { useSyncExternalStore } from "react"

const QUERY = "(prefers-reduced-motion: reduce)"

// the media query, null where theres no matchMedia (tests, old browsers)
function media(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(QUERY) : null
  } catch {
    return null
  }
}

// true when the user asked the OS for less motion
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const m = media()
      m?.addEventListener("change", fn)
      return () => m?.removeEventListener("change", fn)
    },
    () => media()?.matches ?? false,
    () => false,
  )
}
