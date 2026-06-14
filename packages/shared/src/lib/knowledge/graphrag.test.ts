import { describe, expect, it } from "vitest"

import { canonicalEntityId, isGraphEmpty, normalizeEntity } from "./graphrag"

describe("canonicalEntityId", () => {
  it("is a 32-hex string", () => {
    expect(canonicalEntityId("Y Combinator", "company")).toMatch(/^[0-9a-f]{32}$/)
  })

  it("is stable across case/whitespace variation", () => {
    const a = canonicalEntityId("GPT-4 mini", "technology")
    const b = canonicalEntityId("  gpt-4   MINI ", "technology")
    expect(a).toBe(b)
  })

  it("differs by type", () => {
    expect(canonicalEntityId("Apple", "company")).not.toBe(canonicalEntityId("Apple", "concept"))
  })

  it("defaults a blank type to concept", () => {
    expect(canonicalEntityId("Thing", "")).toBe(canonicalEntityId("Thing", "concept"))
  })
})

describe("normalizeEntity", () => {
  it("fills entityId and lowercases the type", () => {
    const e = normalizeEntity({ canonicalName: "Stripe", type: "Company", confidence: 0.8 })
    expect(e?.entityId).toMatch(/^[0-9a-f]{32}$/)
    expect(e?.type).toBe("company")
  })

  it("dedupes aliases and drops the canonical/blank ones", () => {
    const e = normalizeEntity({
      canonicalName: "Stripe",
      aliases: ["stripe", "Stripe Inc", "Stripe Inc", "", "Stripe Payments"],
    })
    expect(e?.aliases).toEqual(["Stripe Inc", "Stripe Payments"])
  })

  it("clamps confidence and rejects blank names", () => {
    expect(normalizeEntity({ canonicalName: "  " })).toBeNull()
    expect(normalizeEntity({ canonicalName: "X", confidence: 2 })?.confidence).toBe(1)
  })
})

describe("isGraphEmpty", () => {
  it("is true for null or empty graphs", () => {
    expect(isGraphEmpty(null)).toBe(true)
    expect(
      isGraphEmpty({ materialId: "m", entities: [], relations: [], extractorVersion: "v1" }),
    ).toBe(true)
  })
})
