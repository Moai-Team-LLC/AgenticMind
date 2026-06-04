import { describe, expect, it } from "vitest"

import { packByTokenBudget } from "./context-budget"

const size = (n: number): number => n

describe("packByTokenBudget", () => {
  it("keeps items in order until the budget would be exceeded", () => {
    expect(packByTokenBudget([3, 3, 3, 3], 7, size)).toEqual([3, 3])
  })

  it("always keeps at least the first item, even when it alone exceeds budget", () => {
    expect(packByTokenBudget([100, 1], 10, size)).toEqual([100])
  })

  it("treats budget <= 0 as no cap", () => {
    expect(packByTokenBudget([5, 5, 5], 0, size)).toEqual([5, 5, 5])
  })

  it("returns everything when it all fits", () => {
    expect(packByTokenBudget([1, 1, 1], 100, size)).toEqual([1, 1, 1])
  })

  it("is empty for empty input", () => {
    expect(packByTokenBudget([], 100, size)).toEqual([])
  })
})
