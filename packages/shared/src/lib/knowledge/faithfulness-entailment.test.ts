import { describe, expect, it } from "vitest"

import type { EntailmentClaim } from "./faithfulness-entailment"

import { aggregateEntailment, buildEntailmentUser } from "./faithfulness-entailment"

const claims = (...texts: string[]): EntailmentClaim[] =>
  texts.map((claim) => {
    return { claim, snippets: [`snippet for ${claim}`] }
  })

describe("aggregateEntailment", () => {
  it("semanticGroundedness = entailed / judged", () => {
    const out = aggregateEntailment(claims("a", "b", "c", "d"), [
      { index: 0, verdict: "entailed" },
      { index: 1, verdict: "entailed" },
      { index: 2, verdict: "not_entailed" },
      { index: 3, verdict: "entailed" },
    ])
    expect(out.semanticGroundedness).toBe(0.75)
    expect(out.contradictedClaims).toEqual(["c"])
  })

  it("excludes 'unknown' from the denominator", () => {
    const out = aggregateEntailment(claims("a", "b", "c"), [
      { index: 0, verdict: "entailed" },
      { index: 1, verdict: "unknown" },
      { index: 2, verdict: "not_entailed" },
    ])
    // judged = 2 (a, c); entailed = 1 → 0.5
    expect(out.semanticGroundedness).toBe(0.5)
    expect(out.contradictedClaims).toEqual(["c"])
  })

  it("treats a missing index as unknown (not a contradiction)", () => {
    const out = aggregateEntailment(claims("a", "b"), [{ index: 0, verdict: "entailed" }])
    expect(out.semanticGroundedness).toBe(1)
    expect(out.contradictedClaims).toEqual([])
  })

  it("returns groundedness 1 and no contradictions when nothing is judged", () => {
    const out = aggregateEntailment(claims("a", "b"), [
      { index: 0, verdict: "unknown" },
      { index: 1, verdict: "unknown" },
    ])
    expect(out.semanticGroundedness).toBe(1)
    expect(out.contradictedClaims).toEqual([])
  })

  it("first verdict for an index wins (ignores duplicates)", () => {
    const out = aggregateEntailment(claims("a"), [
      { index: 0, verdict: "entailed" },
      { index: 0, verdict: "not_entailed" },
    ])
    expect(out.semanticGroundedness).toBe(1)
    expect(out.contradictedClaims).toEqual([])
  })

  it("caps contradicted claims at 10", () => {
    const many = claims(...Array.from({ length: 15 }, (_, i) => `claim${i}`))
    const verdicts = many.map((_, index) => {
      return { index, verdict: "not_entailed" as const }
    })
    const out = aggregateEntailment(many, verdicts)
    expect(out.contradictedClaims).toHaveLength(10)
    expect(out.semanticGroundedness).toBe(0)
  })
})

describe("buildEntailmentUser", () => {
  it("numbers each claim from 0 and lists its snippets", () => {
    const user = buildEntailmentUser([
      { claim: "Sales rose 12%.", snippets: ["Q3 sales were up twelve percent."] },
      { claim: "HQ is in Berlin.", snippets: [] },
    ])
    expect(user).toContain("Claim [0]: Sales rose 12%.")
    expect(user).toContain("  - Q3 sales were up twelve percent.")
    expect(user).toContain("Claim [1]: HQ is in Berlin.")
    expect(user).toContain("(no snippet)")
  })
})
