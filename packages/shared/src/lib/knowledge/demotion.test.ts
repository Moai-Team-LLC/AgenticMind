import { describe, expect, it } from "vitest"

import type { DemotionCandidate } from "./demotion"

import { DEMOTION_MIN_FEEDBACK, DEMOTION_SCORE_THRESHOLD } from "./clustering"
import { demotionReason, shouldDemote } from "./demotion"

const base: DemotionCandidate = {
  clusterId: "c1",
  cardId: "k1",
  state: "promoted",
  aggregateScore: -1,
  feedbackCount: 10,
  cardStatus: "approved",
}

describe("shouldDemote (anti-entrenchment)", () => {
  it("demotes a promoted, live card with enough negative feedback", () => {
    expect(shouldDemote(base)).toBe(true)
  })

  it("demotes exactly at the negative score floor", () => {
    expect(shouldDemote({ ...base, aggregateScore: DEMOTION_SCORE_THRESHOLD })).toBe(true)
  })

  it("keeps a card whose score is just above the floor", () => {
    expect(shouldDemote({ ...base, aggregateScore: DEMOTION_SCORE_THRESHOLD + 0.01 })).toBe(false)
  })

  it("keeps a positively-scored (still-loved) card", () => {
    expect(shouldDemote({ ...base, aggregateScore: 0.9 })).toBe(false)
  })

  it("requires the minimum feedback volume before acting", () => {
    expect(shouldDemote({ ...base, feedbackCount: DEMOTION_MIN_FEEDBACK - 1 })).toBe(false)
    expect(shouldDemote({ ...base, feedbackCount: DEMOTION_MIN_FEEDBACK })).toBe(true)
  })

  it("only acts on sticky promoted clusters", () => {
    expect(shouldDemote({ ...base, state: "ready" })).toBe(false)
    expect(shouldDemote({ ...base, state: "vetoed" })).toBe(false)
    expect(shouldDemote({ ...base, state: "open" })).toBe(false)
  })

  it("is a no-op on already non-retrievable cards", () => {
    expect(shouldDemote({ ...base, cardStatus: "deprecated" })).toBe(false)
    expect(shouldDemote({ ...base, cardStatus: "rejected" })).toBe(false)
    expect(shouldDemote({ ...base, cardStatus: "archived" })).toBe(false)
  })

  it("honours custom thresholds", () => {
    expect(shouldDemote({ ...base, aggregateScore: -0.2 }, { scoreThreshold: -0.1 })).toBe(true)
    expect(shouldDemote({ ...base, feedbackCount: 2 }, { minFeedback: 2 })).toBe(true)
  })
})

describe("demotionReason", () => {
  it("records the score and feedback volume", () => {
    const reason = demotionReason(base)
    expect(reason).toContain("-1.00")
    expect(reason).toContain("10 feedback")
    expect(reason).toContain("anti-entrenchment")
  })
})
