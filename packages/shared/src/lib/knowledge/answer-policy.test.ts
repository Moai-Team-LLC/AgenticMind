import { describe, expect, it } from "vitest"

import {
  evaluatePolicy,
  parseAnswerPolicy,
  parseAnswerPolicyResult,
  policyReviewStatus,
  SEMANTIC_MISSING_REASON,
  withProfileDefaults,
} from "./answer-policy"

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

describe("parseAnswerPolicyResult (A6: unset vs invalid)", () => {
  it("unset or blank is not an error", () => {
    for (const raw of [undefined, null, "", "  "]) {
      expect(parseAnswerPolicyResult(raw)._unsafeUnwrap()).toBeNull()
    }
  })

  it("invalid JSON and schema violations are errors, with the reason", () => {
    expect(parseAnswerPolicyResult("{minGroundedness:0.8}")._unsafeUnwrapErr()).toMatch(
      /^not valid JSON \(/u,
    )
    expect(parseAnswerPolicyResult('{"minGroundedness":2}')._unsafeUnwrapErr()).toBe(
      "minGroundedness: Too big: expected number to be <=1",
    )
    expect(parseAnswerPolicyResult('{"bogus":true}').isErr()).toBe(true)
    expect(parseAnswerPolicyResult('{"requireSemanticVerification":"maybe"}').isErr()).toBe(true)
  })

  it("a valid policy parses identically to parseAnswerPolicy", () => {
    const raw = '{"minSemanticGroundedness":0.95,"requireSemanticVerification":"review"}'
    expect(parseAnswerPolicyResult(raw)._unsafeUnwrap()).toEqual(parseAnswerPolicy(raw))
  })
})

describe("missing signals (A6)", () => {
  const semanticFloor = { minSemanticGroundedness: 0.95 } as const

  it("today: a missing semantic signal silently skips the 0.95 floor", () => {
    expect(evaluatePolicy(semanticFloor, { status: "supported", groundedness: 1 })).toEqual({
      action: "allow",
      reasons: [],
    })
  })

  it("requireSemanticVerification: review / block when the signal is missing at 0.95", () => {
    const input = { status: "supported" as const, groundedness: 1 }
    expect(
      evaluatePolicy({ ...semanticFloor, requireSemanticVerification: "review" }, input),
    ).toEqual({ action: "review", reasons: [SEMANTIC_MISSING_REASON] })
    expect(
      evaluatePolicy({ ...semanticFloor, requireSemanticVerification: "block" }, input),
    ).toEqual({ action: "block", reasons: [SEMANTIC_MISSING_REASON] })
  })

  it("requireSemanticVerification does not fire when the signal is present", () => {
    const d = evaluatePolicy(
      { ...semanticFloor, requireSemanticVerification: "block" },
      { status: "supported", groundedness: 1, semanticGroundedness: 0.97 },
    )
    expect(d).toEqual({ action: "allow", reasons: [] })
  })

  it("missing Tier-A groundedness passes in standard and blocks under the strict default", () => {
    const floor = { minGroundedness: 0.8 }
    expect(evaluatePolicy(floor, { status: "supported" }).action).toBe("allow")
    const strict = withProfileDefaults(floor, "strict")
    expect(strict).toEqual({ minGroundedness: 0.8, missingGroundedness: "block" })
    expect(evaluatePolicy(strict!, { status: "supported" })).toEqual({
      action: "block",
      reasons: ["groundedness signal missing (missingGroundedness: block)"],
    })
    // standard leaves the policy as configured; an explicit setting wins in strict.
    expect(withProfileDefaults(floor, "standard")).toBe(floor)
    expect(withProfileDefaults({ ...floor, missingGroundedness: "pass" }, "strict")).toEqual({
      ...floor,
      missingGroundedness: "pass",
    })
    expect(withProfileDefaults(undefined, "strict")).toBeUndefined()
  })
})

describe("policyReviewStatus (missing semantic signal under review)", () => {
  const policy = { requireSemanticVerification: "review" } as const
  const review = { action: "review" as const, reasons: [SEMANTIC_MISSING_REASON] }

  it("marks supported / partial answers needs_review", () => {
    expect(policyReviewStatus(policy, review, { status: "supported" })).toBe("needs_review")
    expect(policyReviewStatus(policy, review, { status: "partial" })).toBe("needs_review")
    expect(policyReviewStatus(policy, review, {})).toBe("needs_review")
  })

  it("never overwrites the stronger unsupported / conflicted statuses", () => {
    expect(policyReviewStatus(policy, review, { status: "unsupported" })).toBe("unsupported")
    expect(policyReviewStatus(policy, review, { status: "conflicted" })).toBe("conflicted")
  })

  it("control: leaves the status alone when the signal is present or the decision is allow", () => {
    expect(
      policyReviewStatus(policy, review, { status: "supported", semanticGroundedness: 0.9 }),
    ).toBe("supported")
    expect(
      policyReviewStatus(policy, { action: "allow", reasons: [] }, { status: "supported" }),
    ).toBe("supported")
  })
})
