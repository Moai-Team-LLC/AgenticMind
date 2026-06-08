import { describe, expect, it } from "vitest"

import { scoreFaithfulness, supportedClaims } from "./faithfulness"

const cite = (...nums: number[]): { number: number }[] =>
  nums.map((number) => {
    return { number }
  })

describe("scoreFaithfulness", () => {
  it("scores a fully-cited answer as grounded", () => {
    const r = scoreFaithfulness(
      "PostgreSQL is an open-source relational database [1]. It supports ACID transactions [2].",
      cite(1, 2),
      4,
    )
    expect(r.groundedness).toBe(1)
    expect(r.unsupportedClaims).toEqual([])
    expect(r.abstained).toBe(false)
  })

  it("flags a partially-cited answer and lists the uncited claim", () => {
    const r = scoreFaithfulness(
      "Sales rose 12% last quarter [1]. The team plans to double headcount next year.",
      cite(1),
      3,
    )
    expect(r.groundedness).toBe(0.5)
    expect(r.unsupportedClaims).toEqual(["The team plans to double headcount next year."])
    expect(r.abstained).toBe(false)
  })

  it("treats a confident but entirely uncited answer as ungrounded, not abstained", () => {
    const r = scoreFaithfulness(
      "The widget API rate limit is 100 requests per second. Burst traffic is throttled.",
      cite(),
      5,
    )
    expect(r.groundedness).toBe(0)
    expect(r.unsupportedClaims.length).toBe(2)
    expect(r.abstained).toBe(false)
  })

  it("abstains when no sources were retrieved", () => {
    const r = scoreFaithfulness("I don't have information about that in the sources.", cite(), 0)
    expect(r.abstained).toBe(true)
    // The decline sentence is not counted as an unsupported factual claim.
    expect(r.unsupportedClaims).toEqual([])
    expect(r.groundedness).toBe(1)
  })

  it("abstains on a refusal phrasing even when sources existed", () => {
    const r = scoreFaithfulness("I couldn't find that in the provided sources.", cite(), 6)
    expect(r.abstained).toBe(true)
    expect(r.unsupportedClaims).toEqual([])
  })

  it("counts a hallucinated citation number as unsupported", () => {
    // The answer cites [9] but only sources 1 and 2 resolved.
    const r = scoreFaithfulness("The figure was 42% according to the report [9].", cite(1, 2), 3)
    expect(r.groundedness).toBe(0)
    expect(r.unsupportedClaims.length).toBe(1)
  })

  it("ignores boilerplate sentences below the claim-word floor", () => {
    const r = scoreFaithfulness("Yes. PostgreSQL was first released in 1996 [1].", cite(1), 2)
    expect(r.groundedness).toBe(1)
    expect(r.unsupportedClaims).toEqual([])
  })

  it("handles newline/bulleted answers", () => {
    const r = scoreFaithfulness("- The cap is 40% [1]\n- It applies per cycle", cite(1), 3)
    expect(r.groundedness).toBe(0.5)
    expect(r.unsupportedClaims).toEqual(["It applies per cycle"])
  })

  it("counts a hedge that still carries a citation as supported", () => {
    const r = scoreFaithfulness(
      "I couldn't find an exact figure, but the sources cite a 40% target [1].",
      cite(1),
      4,
    )
    expect(r.groundedness).toBe(1)
    expect(r.abstained).toBe(false)
  })
})

describe("supportedClaims", () => {
  it("returns only claim-sentences with a resolving citation, deduped", () => {
    const out = supportedClaims(
      "Sales rose 12% [1]. The market is uncertain. Costs fell [2][2].",
      cite(1, 2),
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ claim: "Sales rose 12% [1].", citedNumbers: [1] })
    expect(out[1]).toEqual({ claim: "Costs fell [2][2].", citedNumbers: [2] })
  })

  it("ignores claims whose citation does not resolve", () => {
    expect(supportedClaims("Profit doubled [9].", cite(1))).toEqual([])
  })
})
