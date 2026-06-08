import { describe, expect, it } from "vitest"

import { deriveAnswerStatus, restsOnlyOnStaleSources } from "./answer-status"

describe("deriveAnswerStatus", () => {
  it("supported: every claim cited, no conflicts", () => {
    expect(deriveAnswerStatus({ groundedness: 1, abstained: false })).toBe("supported")
  })

  it("supported requires semantic floor when Tier-B ran", () => {
    expect(deriveAnswerStatus({ groundedness: 1, semanticGroundedness: 0.9 })).toBe("supported")
    // Cited everywhere, but semantics weak → demoted to partial (no contradictions).
    expect(deriveAnswerStatus({ groundedness: 1, semanticGroundedness: 0.6 })).toBe("partial")
  })

  it("partial: some claims grounded, some not", () => {
    expect(deriveAnswerStatus({ groundedness: 0.6 })).toBe("partial")
  })

  it("unsupported: almost nothing grounded", () => {
    expect(deriveAnswerStatus({ groundedness: 0.2 })).toBe("unsupported")
  })

  it("unsupported: an honest decline (abstained) outranks any groundedness", () => {
    expect(deriveAnswerStatus({ groundedness: 1, abstained: true })).toBe("unsupported")
  })

  it("conflicted: retrieved sources disagree (outranks the grounded gradient)", () => {
    expect(deriveAnswerStatus({ groundedness: 1, contested: [{}, {}] })).toBe("conflicted")
  })

  it("needs_review: a cited claim is not entailed by its own snippet", () => {
    expect(
      deriveAnswerStatus({ groundedness: 1, semanticGroundedness: 0.9, contradictedClaims: ["x"] }),
    ).toBe("needs_review")
  })

  it("severity precedence: abstain > conflict > needs_review > gradient", () => {
    // abstain wins over conflict + contradiction
    expect(
      deriveAnswerStatus({ abstained: true, contested: [{}], contradictedClaims: ["x"] }),
    ).toBe("unsupported")
    // conflict wins over a contradiction
    expect(deriveAnswerStatus({ contested: [{}], contradictedClaims: ["x"] })).toBe("conflicted")
  })

  it("defaults to grounded when no signals are present (groundedness assumed 1)", () => {
    expect(deriveAnswerStatus({})).toBe("supported")
  })
})

describe("restsOnlyOnStaleSources", () => {
  it("true when every cited source is non-active", () => {
    expect(
      restsOnlyOnStaleSources([{ lifecycle: "superseded" }, { lifecycle: "deprecated" }]),
    ).toBe(true)
  })

  it("false when any cited source is active or unknown", () => {
    expect(restsOnlyOnStaleSources([{ lifecycle: "superseded" }, { lifecycle: "active" }])).toBe(
      false,
    )
    expect(restsOnlyOnStaleSources([{ lifecycle: "superseded" }, {}])).toBe(false)
  })

  it("false when there are no citations", () => {
    expect(restsOnlyOnStaleSources([])).toBe(false)
  })
})

describe("deriveAnswerStatus — stale sources", () => {
  it("escalates a grounded answer to needs_review when it rests only on stale sources", () => {
    expect(deriveAnswerStatus({ groundedness: 1, staleSourcesOnly: true })).toBe("needs_review")
  })

  it("conflict still outranks stale-only", () => {
    expect(deriveAnswerStatus({ contested: [{}], staleSourcesOnly: true })).toBe("conflicted")
  })
})
