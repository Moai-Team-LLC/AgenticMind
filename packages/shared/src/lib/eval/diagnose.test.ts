import { describe, expect, it } from "vitest"

import { classifyAnswer } from "./diagnose"

describe("classifyAnswer — symptom → stage → knob", () => {
  it("flags the hallucination shape (0 citations, groundedness 0, not abstained)", () => {
    const d = classifyAnswer({
      citationsCount: 0,
      groundedness: 0,
      abstained: false,
      status: "unsupported",
    })
    expect(d[0]?.stage).toContain("synthesis")
    expect(d[0]?.severity).toBe("high")
    expect(d[0]?.knob).toContain("minGroundedness")
  })

  it("points at the cache when servedBy=cache", () => {
    const d = classifyAnswer({ servedBy: "cache", groundedness: 0.9, citationsCount: 2 })
    expect(d.some((x) => x.stage === "answer cache")).toBe(true)
  })

  it("flags a fabricated figure (ungroundedFigures)", () => {
    const d = classifyAnswer({ citationsCount: 2, groundedness: 0.9, ungroundedFigures: 1 })
    const f = d.find((x) => x.stage.includes("numeric"))
    expect(f?.severity).toBe("high")
  })

  it("flags a fabricated quotation (ungroundedQuotes)", () => {
    const d = classifyAnswer({ citationsCount: 2, groundedness: 0.9, ungroundedQuotes: 1 })
    expect(d.find((x) => x.stage.includes("quotation"))?.severity).toBe("high")
  })

  it("flags a mis-attributed citation (weaklyAttributedClaims)", () => {
    const d = classifyAnswer({ citationsCount: 2, groundedness: 0.9, weaklyAttributedClaims: 1 })
    const f = d.find((x) => x.stage.includes("attribution"))
    expect(f?.severity).toBe("high")
  })

  it("flags cited-but-unentailed via contradictedClaims", () => {
    const d = classifyAnswer({ citationsCount: 2, groundedness: 0.9, contradictedClaims: 1 })
    const f = d.find((x) => x.stage.includes("Tier-B"))
    expect(f?.severity).toBe("high")
  })

  it("routes stale-only answers to source lifecycle", () => {
    const d = classifyAnswer({ citationsCount: 1, staleSourcesOnly: true, status: "needs_review" })
    expect(d.some((x) => x.stage === "source lifecycle")).toBe(true)
  })

  it("treats contested/conflicted as working-as-designed (info, no knob)", () => {
    const d = classifyAnswer({ citationsCount: 2, contestedCount: 2, status: "conflicted" })
    const f = d.find((x) => x.stage.includes("contested"))
    expect(f?.severity).toBe("info")
  })

  it("treats abstention as working-as-designed", () => {
    const d = classifyAnswer({ citationsCount: 0, abstained: true })
    expect(d.some((x) => x.stage.includes("abstention"))).toBe(true)
  })

  it("blames the corpus when the answer is grounded but reported wrong", () => {
    const d = classifyAnswer({ citationsCount: 3, groundedness: 0.9, status: "supported" })
    expect(d).toHaveLength(1)
    expect(d[0]?.stage).toBe("source / corpus")
    expect(d[0]?.severity).toBe("info")
  })

  it("surfaces the slowest stage when latency is the complaint", () => {
    const d = classifyAnswer({
      citationsCount: 2,
      groundedness: 0.9,
      phases: [
        { phase: "retrieve", ms: 200 },
        { phase: "synth", ms: 6000 },
      ],
    })
    expect(d.some((x) => x.stage === "latency: synth")).toBe(true)
  })

  it("flags weak grounding when sources exist but claims are uncited", () => {
    const d = classifyAnswer({ citationsCount: 2, groundedness: 0.2 })
    expect(d[0]?.stage).toBe("retrieval")
  })
})
