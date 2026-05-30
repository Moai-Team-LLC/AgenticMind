import { describe, expect, it } from "vitest"

import { fingerprintSources, hashQuestion, normaliseQuestion } from "./answer-cache-keys"

describe("normaliseQuestion", () => {
  it("lowercases, collapses whitespace and strips trailing punctuation", () => {
    expect(normaliseQuestion("  What  is   X??! ")).toBe("what is x")
  })
  it("is empty for blank input", () => {
    expect(normaliseQuestion("   ")).toBe("")
  })
})

describe("hashQuestion", () => {
  it("is a 64-hex sha256 stable across surface variation", () => {
    const a = hashQuestion("What is Y Combinator?")
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(hashQuestion("  what is y combinator "))
  })
  it("differs for different questions", () => {
    expect(hashQuestion("a")).not.toBe(hashQuestion("b"))
  })
})

describe("fingerprintSources", () => {
  it("is order-independent (sorted by id)", () => {
    const d1 = new Date("2026-01-01T00:00:00Z")
    const d2 = new Date("2026-02-01T00:00:00Z")
    const a = fingerprintSources([
      { materialId: "b", updatedAt: d2 },
      { materialId: "a", updatedAt: d1 },
    ])
    const b = fingerprintSources([
      { materialId: "a", updatedAt: d1 },
      { materialId: "b", updatedAt: d2 },
    ])
    expect(a).toBe(b)
  })
  it("changes when a timestamp changes", () => {
    const base = fingerprintSources([
      { materialId: "a", updatedAt: new Date("2026-01-01T00:00:00Z") },
    ])
    const moved = fingerprintSources([
      { materialId: "a", updatedAt: new Date("2026-01-02T00:00:00Z") },
    ])
    expect(base).not.toBe(moved)
  })
})
