// PACED FEED TESTS
// Purpose: the feed lets in at most one new item per step

import { describe, expect, it } from "vitest"
import { paceStep } from "./usePacedFeed"

function key(n: number) {
  return String(n)
}

describe("paceStep (feed limited to ~1 new item per second)", () => {
  it("shows the first batch at once", () => {
    expect(paceStep([], [3, 2, 1], key, 3)).toEqual([3, 2, 1])
  })

  it("adds one new item per step, oldest first", () => {
    let shown: readonly number[] = [3, 2, 1]
    const items = [6, 5, 4, 3, 2, 1]
    shown = paceStep(shown, items, key, 6)
    expect(shown).toEqual([4, 3, 2, 1])
    shown = paceStep(shown, items, key, 6)
    expect(shown).toEqual([5, 4, 3, 2, 1])
    shown = paceStep(shown, items, key, 6)
    shown = paceStep(shown, items, key, 6)
    expect(shown).toEqual([6, 5, 4, 3, 2, 1])
  })

  it("skips the oldest of a long burst and keeps the list length", () => {
    const items = Array.from({ length: 20 }, (_, i) => 20 - i) // 20..1
    const out = paceStep([1], items, key, 5)
    expect(out).toEqual([13, 1])
    expect(paceStep([5, 4, 3, 2, 1], [6, 5, 4, 3, 2], key, 5)).toEqual([6, 5, 4, 3, 2])
  })
})
