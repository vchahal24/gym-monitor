// ANIMATED NUMBER
// Purpose: a number that glides to its new value instead of jumping

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "../hooks/useReducedMotion"

const DURATION_MS = 600

// tweens a number to its new value (ease out, ~600 ms) so the summary figures glide instead of jumping
// with reduced motion it just jumps straight there
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const shownRef = useRef(value)

  useEffect(() => {
    if (reduced || shownRef.current === value) {
      shownRef.current = value
      setShown(value)
      return
    }
    from.current = shownRef.current
    const start = performance.now()
    let raf = 0
    function step(t: number) {
      const k = Math.min(1, (t - start) / DURATION_MS)
      const eased = 1 - (1 - k) ** 3
      const v = from.current + (value - from.current) * eased
      shownRef.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, reduced])

  return <span className="tabular-nums">{format(shown)}</span>
}
