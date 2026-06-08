import { describe, expect, it } from "vitest"

import { applyTrust, defaultTrustConfig } from "./source-trust"

describe("applyTrust", () => {
  it("leaves an active, untrusted-tier source unchanged", () => {
    expect(applyTrust(1, "active", 0)).toBe(1)
  })

  it("down-weights by lifecycle (active > deprecated > superseded > archived)", () => {
    const active = applyTrust(1, "active", 0)
    const deprecated = applyTrust(1, "deprecated", 0)
    const superseded = applyTrust(1, "superseded", 0)
    const archived = applyTrust(1, "archived", 0)
    expect(active).toBeGreaterThan(deprecated)
    expect(deprecated).toBeGreaterThan(superseded)
    expect(superseded).toBeGreaterThan(archived)
    expect(archived).toBeCloseTo(0.05, 10)
  })

  it("boosts by trust tier", () => {
    expect(applyTrust(1, "active", 4)).toBeCloseTo(1.2, 10) // 1 + 4*0.05
    expect(applyTrust(1, "active", 2)).toBeGreaterThan(applyTrust(1, "active", 0))
  })

  it("a high-trust deprecated source can still rank below a fresh active one", () => {
    // deprecated tier-2 (0.6 * 1.1 = 0.66) < active tier-0 (1.0)
    expect(applyTrust(1, "deprecated", 2)).toBeLessThan(applyTrust(1, "active", 0))
  })

  it("treats an unknown lifecycle as neutral", () => {
    expect(applyTrust(1, "whatever", 0)).toBe(1)
  })

  it("floors negative trust tiers at 0 and clamps the result ≥ 0", () => {
    expect(applyTrust(1, "active", -5)).toBe(1)
    expect(applyTrust(0, "archived", 0)).toBe(0)
  })

  it("honours a custom config", () => {
    const cfg = defaultTrustConfig()
    cfg.lifecycleWeight.deprecated = 0.9
    expect(applyTrust(1, "deprecated", 0, cfg)).toBeCloseTo(0.9, 10)
  })
})
