import { describe, expect, it } from "vitest"

import { summarizeAskHealth } from "./health"

describe("summarizeAskHealth (fleet drift detection)", () => {
  it("computes rates and raises no concern on a healthy fleet", () => {
    const s = summarizeAskHealth([
      { status: "supported", count: 90 },
      { status: "partial", count: 8 },
      { status: "needs_review", count: 2 },
    ])
    expect(s.total).toBe(100)
    expect(s.rate.supported).toBeCloseTo(0.9)
    expect(s.concerns).toEqual([])
  })

  it("flags a needs_review spike", () => {
    const s = summarizeAskHealth([
      { status: "supported", count: 70 },
      { status: "needs_review", count: 30 },
    ])
    expect(s.concerns.some((c) => c.includes("needs_review"))).toBe(true)
  })

  it("flags an unsupported spike (model/corpus regression signature)", () => {
    const s = summarizeAskHealth([
      { status: "supported", count: 60 },
      { status: "unsupported", count: 40 },
    ])
    expect(s.concerns.some((c) => c.includes("unsupported"))).toBe(true)
  })

  it("treats a null-status majority as an instrumentation concern", () => {
    const s = summarizeAskHealth([
      { status: null, count: 80 },
      { status: "supported", count: 20 },
    ])
    expect(s.concerns.some((c) => c.includes("untracked"))).toBe(true)
  })

  it("honours custom thresholds", () => {
    const rows = [
      { status: "supported", count: 95 },
      { status: "conflicted", count: 5 },
    ]
    expect(summarizeAskHealth(rows).concerns).toEqual([]) // 5% < 10% default
    expect(summarizeAskHealth(rows, { conflicted: 0.02 }).concerns.length).toBe(1)
  })

  it("is empty-safe", () => {
    expect(summarizeAskHealth([]).concerns).toEqual([])
    expect(summarizeAskHealth([]).total).toBe(0)
  })
})
