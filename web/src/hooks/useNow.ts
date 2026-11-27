// USE NOW
// Purpose: the current time on the data clock for countdowns and refreshes

import { useContext, useEffect, useState } from "react"
import { DataContext } from "../data/context"
import { realClock } from "../data/clock"

// current time on the data clock (the demos sim clock in mock mode)
// re-renders every intervalMs of real time, quicker when the demo is sped up so countdowns follow the speed
export function useNow(intervalMs = 1000): Date {
  const clock = useContext(DataContext)?.clock ?? realClock
  const [now, setNow] = useState(() => new Date(clock.now()))
  const [speed, setSpeed] = useState(() => clock.getState().speed)
  useEffect(() => clock.subscribe(() => setSpeed(clock.getState().speed)), [clock])
  useEffect(() => {
    // short intervals (timers) tick faster when sped up, at most 4x a second
    // long ones (refreshes) keep their pace in sim time, but data refreshes (> 1 min)
    // never go more than every 5 real seconds so 240× doesnt flood the data source
    let floor = 1000
    if (intervalMs <= 1000) floor = 250
    else if (intervalMs > 60_000) floor = 5000
    const every = Math.max(floor, intervalMs / speed)
    const t = setInterval(() => setNow(new Date(clock.now())), every)
    return () => clearInterval(t)
  }, [intervalMs, clock, speed])
  return now
}
