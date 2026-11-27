// USE DEMO
// Purpose: hooks the demo panel up to the mock controls and sim clock

import { useSyncExternalStore } from "react"
import { realClock } from "../data/clock"
import { useDataContext } from "./internal"

// demo panel wiring (mock only), controls, the sim clock and reset, undefined against the real backend
export function useDemo() {
  const { ds, simClock, reset } = useDataContext()
  const clock = simClock ?? realClock
  const state = useSyncExternalStore(clock.subscribe, clock.getState)
  if (!ds.demo || !simClock || !reset) return undefined
  const demo = ds.demo
  return {
    controls: demo,
    speed: state.speed,
    paused: state.paused,
    setSpeed: (s: number) => simClock.setSpeed(s),
    setPaused: (p: boolean) => {
      simClock.setPaused(p)
      demo.setPaused(p)
    },
    reset,
  }
}
