import { describe, expect, it } from "vitest"

import { buildPlannerPrompt, formatRows, parsePlannerResponse } from "./qaplan"

describe("buildPlannerPrompt", () => {
  it("renders the ontology vocabulary", () => {
    const p = buildPlannerPrompt()
    expect(p).toContain("Allowed entity types")
    expect(p).toContain("- Person:")
    expect(p).toContain("- works_at —")
  })
})

describe("parsePlannerResponse", () => {
  it("passes through not-applicable", () => {
    expect(parsePlannerResponse({ applicable: false, reason: "narrative" })).toEqual({
      applicable: false,
      reason: "narrative",
    })
  })

  it("builds a valid spec from ontology-conformant hops", () => {
    const r = parsePlannerResponse({
      applicable: true,
      reason: "single hop",
      spec: {
        startType: "Person",
        hops: [{ predicate: "works_at", targetType: "Organization", targetName: "Stripe" }],
        limit: 0,
      },
    })
    expect(r.applicable).toBe(true)
    expect(r.spec?.startType).toBe("Person")
    expect(r.spec?.hops[0]).toEqual({
      predicate: "works_at",
      targetType: "Organization",
      targetName: "Stripe",
    })
    expect(r.spec?.limit).toBe(25) // 0 → default
  })

  it("rejects unknown start/target types and predicates", () => {
    expect(
      parsePlannerResponse({ applicable: true, spec: { startType: "Robot", hops: [] } }).applicable,
    ).toBe(false)
    expect(
      parsePlannerResponse({
        applicable: true,
        spec: { startType: "Person", hops: [{ predicate: "nope", targetType: "Organization" }] },
      }).applicable,
    ).toBe(false)
  })

  it("rejects applicable=true with no spec", () => {
    expect(parsePlannerResponse({ applicable: true }).applicable).toBe(false)
  })
})

describe("formatRows", () => {
  it("renders an arrow chain with ontology types", () => {
    const rows = formatRows([
      {
        path: [
          { entityId: "1", canonicalName: "Alice", ontologyType: "Person", confidence: 1 },
          { entityId: "2", canonicalName: "Stripe", ontologyType: "Organization", confidence: 1 },
        ],
      },
    ])
    expect(rows[0]?.body).toBe("Alice (Person) → Stripe (Organization)")
  })

  it("skips empty paths", () => {
    expect(formatRows([{ path: [] }])).toEqual([])
  })
})
