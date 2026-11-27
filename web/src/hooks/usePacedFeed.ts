// PACED FEED
// Purpose: lets new feed items in one at a time so a burst slides in instead of jumping

import { useEffect, useRef, useState } from "react"

const MAX_BACKLOG = 8 // most items held back at once, older unseen ones past this get skipped

// one step of the paced feed (pure, for tests)
// given whats shown and the latest items (both newest first), returns the list with at most one new item added
// the first batch gets shown in one go
export function paceStep<T>(shown: readonly T[], items: readonly T[], keyOf: (item: T) => string, limit: number): readonly T[] {
  if (items.length === 0) return shown
  if (shown.length === 0) return items.slice(0, limit)
  const head = keyOf(shown[0])
  const idx = items.findIndex((i) => keyOf(i) === head)
  const newer = idx === -1 ? items : items.slice(0, idx)
  if (newer.length === 0) return shown
  // the oldest of the newest few, so a long burst skips its oldest items
  const next = newer[Math.min(newer.length, MAX_BACKLOG) - 1]
  return [next, ...shown].slice(0, limit)
}

// lets new items into a feed at most once per intervalMs, so a burst of events
// (lots of machines changing at once, or a sped up demo) slides in one by one instead of jumping
// items are newest first, and so is the result
export function usePacedFeed<T>(items: readonly T[], keyOf: (item: T) => string, intervalMs = 1000): readonly T[] {
  const [shown, setShown] = useState<readonly T[]>(items)
  const latest = useRef({ items, keyOf })
  useEffect(() => {
    latest.current = { items, keyOf }
  })
  useEffect(() => {
    const t = setInterval(() => {
      const { items: list, keyOf: key } = latest.current
      setShown((prev) => paceStep(prev, list, key, Math.max(list.length, 1)))
    }, intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return shown
}
