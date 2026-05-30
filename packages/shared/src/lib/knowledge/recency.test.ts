import { describe, expect, it } from "vitest"

import { boost, defaultRecencyConfig, recencyFactor } from "./recency"

const now = new Date("2026-06-01T00:00:00Z")
const cfg = defaultRecencyConfig()
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

describe("recencyFactor", () => {
  it("is 0 for unknown age", () => {
    expect(recencyFactor(null, cfg, now)).toBe(0)
  })

  it("is 1 within the full-boost window", () => {
    expect(recencyFactor(daysAgo(10), cfg, now)).toBe(1)
  })

  it("is 0 past the zero-boost horizon", () => {
    expect(recencyFactor(daysAgo(400), cfg, now)).toBe(0)
  })

  it("decays linearly in between", () => {
    // 30..365 day ramp; midpoint ≈ 197.5d → factor ≈ 0.5
    expect(recencyFactor(daysAgo(197.5), cfg, now)).toBeCloseTo(0.5, 2)
  })
})

describe("boost", () => {
  it("applies the full uplift to a fresh item", () => {
    expect(boost(0.5, daysAgo(1), cfg, now)).toBeCloseTo(0.6) // 0.5 * 1.2
  })

  it("leaves a stale item untouched", () => {
    expect(boost(0.5, daysAgo(400), cfg, now)).toBe(0.5)
  })

  it("is a no-op when maxBoost is 0", () => {
    expect(boost(0.5, daysAgo(1), { ...cfg, maxBoost: 0 }, now)).toBe(0.5)
  })
})
