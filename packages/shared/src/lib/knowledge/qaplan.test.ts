import { describe, expect, it } from "vitest"

import { buildPlannerPrompt, formatRows, parsePlannerResponse } from "./qaplan"

describe("buildPlannerPrompt", () => {
  it("renders the ontology vocabulary", () => {
    const p = buildPlannerPrompt()
    expect(p).toContain("Allowed entity types")
    expect(p).toContain("- Member:")
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
        startType: "Member",
        hops: [{ predicate: "works_at", targetType: "Company", targetName: "Stripe" }],
        limit: 0,
      },
    })
    expect(r.applicable).toBe(true)
    expect(r.spec?.startType).toBe("Member")
    expect(r.spec?.hops[0]).toEqual({
      predicate: "works_at",
      targetType: "Company",
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
        spec: { startType: "Member", hops: [{ predicate: "nope", targetType: "Company" }] },
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
          { entityId: "1", canonicalName: "Alice", ontologyType: "Member", confidence: 1 },
          { entityId: "2", canonicalName: "Stripe", ontologyType: "Company", confidence: 1 },
        ],
      },
    ])
    expect(rows[0]?.body).toBe("Alice (Member) → Stripe (Company)")
  })

  it("skips empty paths", () => {
    expect(formatRows([{ path: [] }])).toEqual([])
  })
})
