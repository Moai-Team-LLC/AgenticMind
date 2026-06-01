import { describe, expect, it } from "vitest"

import { classifyComplexity, modelForComplexity } from "./complexity"

describe("classifyComplexity", () => {
  it("simple fact-lookups", () => {
    expect(classifyComplexity("What is the corporate tax rate in Ireland?")).toBe("simple")
  })
  it("comparative / multi-part are complex", () => {
    expect(classifyComplexity("Compare a SAFE and a convertible note")).toBe("complex")
    expect(classifyComplexity("What is X? And what is Y?")).toBe("complex")
  })
  it("long questions are complex", () => {
    expect(classifyComplexity(Array.from({ length: 30 }, () => "word").join(" "))).toBe("complex")
  })
})

describe("modelForComplexity", () => {
  it("routes cheap vs flagship", () => {
    expect(modelForComplexity("simple")).toBe("google/gemini-3.1-flash-lite-preview")
    expect(modelForComplexity("complex")).toBe("openai/gpt-5-mini")
  })
})
