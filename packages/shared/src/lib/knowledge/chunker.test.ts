import { describe, expect, it } from "vitest"

import { approxTokens, splitText } from "./chunker"

describe("splitText", () => {
  it("returns a single chunk for short input", () => {
    expect(splitText("hello world")).toEqual(["hello world"])
  })

  it("returns nothing for empty / whitespace input", () => {
    for (const input of ["", "   ", "\n\n\n"]) {
      expect(splitText(input)).toHaveLength(0)
    }
  })

  it("splits long text into multiple bounded chunks", () => {
    const body = "Lorem ipsum dolor sit amet. ".repeat(20)
    const out = splitText(body, { maxRunes: 50, overlap: 5 })
    expect(out.length).toBeGreaterThan(1)
    for (const ch of out) {
      // soft cap: allow +25% when a boundary refuses to break mid-sentence
      expect(Array.from(ch).length).toBeLessThanOrEqual(Math.floor((50 * 5) / 4))
      expect(ch.trim()).not.toBe("")
    }
  })

  it("prefers a paragraph boundary", () => {
    const body = `${"a".repeat(80)}\n\n${"b".repeat(80)}`
    const out = splitText(body, { maxRunes: 100, overlap: 0 })
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(out[0]).not.toContain("b")
  })

  it("self-corrects when overlap exceeds max", () => {
    const out = splitText("x".repeat(200), { maxRunes: 50, overlap: 1000 })
    expect(out.length).toBeGreaterThanOrEqual(2)
  })

  it("is deterministic for the same input", () => {
    const body = "Sentence one. Sentence two. ".repeat(100)
    expect(splitText(body)).toEqual(splitText(body))
  })

  it("normalises CRLF", () => {
    const out = splitText("line one\r\nline two")
    expect(out).toHaveLength(1)
    expect(out[0]).not.toContain("\r")
  })
})

describe("splitText — markdown heading awareness", () => {
  it("carves sections and prefixes chunks with their heading", () => {
    const body = `# Doc
intro paragraph.

## Pricing
We charge by the seat. Annual prepay gets 15% off.

## Support
9-to-5 in EU; out-of-band for paying customers.`
    const out = splitText(body)
    expect(out.length).toBeGreaterThanOrEqual(3)
    expect(out.some((ch) => ch.startsWith("## Pricing"))).toBe(true)
    expect(out.some((ch) => ch.startsWith("## Support"))).toBe(true)
  })

  it("does not add heading prefixes when the source has none", () => {
    const body = "Sentence one. Sentence two. ".repeat(30)
    const out = splitText(body, { maxRunes: 200, overlap: 30 })
    expect(out.length).toBeGreaterThan(1)
    for (const ch of out) expect(ch.startsWith("#")).toBe(false)
  })

  it("keeps the prologue before the first heading", () => {
    const out = splitText("Some intro line.\n\n# Body\nbody text.")
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(out[0]).toContain("Some intro line")
    expect(out[1]?.startsWith("# Body")).toBe(true)
  })

  it("keeps the heading prefix on every chunk of a long section", () => {
    const long = "Long sentence describing the section. ".repeat(30)
    const out = splitText(`## Pricing\n${long}`, { maxRunes: 300, overlap: 30 })
    expect(out.length).toBeGreaterThan(1)
    for (const ch of out) expect(ch.startsWith("## Pricing")).toBe(true)
  })
})

describe("approxTokens", () => {
  it("uses the 4-runes-per-token heuristic", () => {
    expect(approxTokens("")).toBe(0)
    expect(approxTokens("abcd")).toBe(1)
    expect(approxTokens("abcde")).toBe(2)
  })
})
