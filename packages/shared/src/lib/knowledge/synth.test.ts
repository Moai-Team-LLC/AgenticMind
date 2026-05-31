import { describe, expect, it } from "vitest"

import type { Citation, Source } from "./synth"

import {
  buildPromptWithGraphContext,
  buildSystemPromptWithContext,
  classifyServedBy,
  formatUpdatedAnnotation,
  parseCitations,
  SOURCE_ORIGIN_CARD,
  SOURCE_ORIGIN_CHUNK,
  SYSTEM_PROMPT,
} from "./synth"

const chunkSource = (n: number, id: string): Source => {
  return {
    number: n,
    chunkId: id,
    materialId: `mat-${n}`,
    title: `Title ${n}`,
    body: `Body ${n}`,
    score: 1,
    updatedAt: null,
    origin: SOURCE_ORIGIN_CHUNK,
  }
}

describe("buildSystemPromptWithContext", () => {
  it("returns the base prompt when the member context is empty", () => {
    expect(buildSystemPromptWithContext(null)).toBe(SYSTEM_PROMPT)
    expect(buildSystemPromptWithContext({})).toBe(SYSTEM_PROMPT)
  })

  it("appends a profile block when present", () => {
    const out = buildSystemPromptWithContext({
      industry: "fintech",
      expertise: ["payments", "ml"],
      recentJourney: "asked about pricing yesterday",
    })
    expect(out).toContain("[user context]")
    expect(out).toContain("- industry: fintech")
    expect(out).toContain("- expertise: payments, ml")
    expect(out).toContain("[recent journey]")
  })
})

describe("formatUpdatedAnnotation", () => {
  it("formats a known date and omits an unknown one", () => {
    expect(formatUpdatedAnnotation(new Date("2026-04-15T10:00:00Z"))).toBe(" (updated 2026-04-15)")
    expect(formatUpdatedAnnotation(null)).toBe("")
  })
})

describe("buildPromptWithGraphContext", () => {
  it("renders sources, graph prelude, and the question/answer scaffold", () => {
    const out = buildPromptWithGraphContext(
      "What is X?",
      [chunkSource(1, "c1")],
      [{ body: "Alice works at Stripe", materialIds: ["m1"] }],
    )
    expect(out).toContain("Graph context (supplementary")
    expect(out).toContain("- Alice works at Stripe")
    expect(out).toContain("[1] Title 1")
    expect(out).toContain("Question: What is X?")
    expect(out.endsWith("Answer:")).toBe(true)
  })

  it("handles the no-sources case", () => {
    expect(buildPromptWithGraphContext("Q", [])).toContain("Sources: (none")
  })
})

describe("parseCitations", () => {
  it("dedupes, drops unresolved markers, and sorts by number", () => {
    const sources = [chunkSource(1, "c1"), chunkSource(2, "c2")]
    const cites = parseCitations("foo [2] bar [1] baz [2] qux [99]", sources)
    expect(cites.map((c) => c.number)).toEqual([1, 2])
  })

  it("returns an empty array when there are no markers", () => {
    expect(parseCitations("no citations here", [chunkSource(1, "c1")])).toEqual([])
  })
})

describe("classifyServedBy", () => {
  const cite = (chunkId: string): Citation => {
    return {
      number: 1,
      materialId: "m",
      title: "t",
      chunkId,
      snippet: "",
      score: 1,
    }
  }

  it("is card_synth when a cited source is a card", () => {
    const sources: Source[] = [{ ...chunkSource(1, "card1"), origin: SOURCE_ORIGIN_CARD }]
    expect(classifyServedBy([cite("card1")], sources)).toBe("card_synth")
  })

  it("is synth for chunk-only citations and for no citations", () => {
    expect(classifyServedBy([cite("c1")], [chunkSource(1, "c1")])).toBe("synth")
    expect(classifyServedBy([], [chunkSource(1, "c1")])).toBe("synth")
  })
})
