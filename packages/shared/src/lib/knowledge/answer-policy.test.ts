import { describe, expect, it } from "vitest"

import { evaluatePolicy, parseAnswerPolicy } from "./answer-policy"

describe("parseAnswerPolicy", () => {
  it("parses a valid policy JSON", () => {
    expect(parseAnswerPolicy('{"minGroundedness":0.8,"reviewOnConflict":true}')).toEqual({
      minGroundedness: 0.8,
      reviewOnConflict: true,
    })
  })

  it("returns undefined for empty / null / malformed input (fail-soft)", () => {
    expect(parseAnswerPolicy("")).toBeUndefined()
    expect(parseAnswerPolicy(null)).toBeUndefined()
    expect(parseAnswerPolicy("not json")).toBeUndefined()
    // out-of-range / unknown keys rejected by the strict schema
    expect(parseAnswerPolicy('{"minGroundedness":2}')).toBeUndefined()
    expect(parseAnswerPolicy('{"bogus":true}')).toBeUndefined()
  })
})

describe("evaluatePolicy", () => {
  it("blocks below the groundedness floor", () => {
    const d = evaluatePolicy({ minGroundedness: 0.8 }, { status: "partial", groundedness: 0.5 })
    expect(d.action).toBe("block")
    expect(d.reasons[0]).toContain("groundedness")
  })

  it("blocks below the semantic floor only when Tier-B ran", () => {
    expect(
      evaluatePolicy(
        { minSemanticGroundedness: 0.8 },
        { status: "supported", groundedness: 1, semanticGroundedness: 0.6 },
      ).action,
    ).toBe("block")
    // semantic signal absent → no semantic block
    expect(
      evaluatePolicy({ minSemanticGroundedness: 0.8 }, { status: "supported", groundedness: 1 })
        .action,
    ).toBe("allow")
  })

  it("blockOnConflict outranks review", () => {
    const d = evaluatePolicy(
      { blockOnConflict: true, reviewOnConflict: true },
      { status: "conflicted", groundedness: 1 },
    )
    expect(d.action).toBe("block")
  })

  it("blockOnNeedsReview hard-refuses any deterministic flag (figure/quote/attribution/stale)", () => {
    const d = evaluatePolicy(
      { blockOnNeedsReview: true },
      { status: "needs_review", groundedness: 1 },
    )
    expect(d.action).toBe("block")
    expect(d.reasons[0]).toContain("blockOnNeedsReview")
  })

  it("blockOnNeedsReview leaves a clean answer untouched", () => {
    expect(
      evaluatePolicy({ blockOnNeedsReview: true }, { status: "supported", groundedness: 1 }).action,
    ).toBe("allow")
  })

  it("review on conflict / needs_review when not blocked", () => {
    expect(
      evaluatePolicy({ reviewOnConflict: true }, { status: "conflicted", groundedness: 1 }).action,
    ).toBe("review")
    expect(
      evaluatePolicy({ reviewOnNeedsReview: true }, { status: "needs_review", groundedness: 1 })
        .action,
    ).toBe("review")
  })

  it("allows when nothing matches", () => {
    expect(
      evaluatePolicy(
        { minGroundedness: 0.5, reviewOnConflict: true },
        { status: "supported", groundedness: 1 },
      ),
    ).toEqual({ action: "allow", reasons: [] })
  })
})
