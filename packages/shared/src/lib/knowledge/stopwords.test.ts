import { describe, expect, it } from "vitest"

import { normaliseQuery, queryVariants } from "./stopwords"

describe("normaliseQuery", () => {
  it("preserves a single-word query verbatim", () => {
    expect(normaliseQuery("matrix")).toBe("matrix")
    expect(normaliseQuery("the")).toBe("the")
  })

  it("strips light English stop-words", () => {
    expect(normaliseQuery("tell me about the matrix")).toBe("matrix")
  })

  it("returns the original when everything is a stop-word", () => {
    expect(normaliseQuery("of the")).toBe("of the")
  })

  it("trims surrounding punctuation when matching stop-words", () => {
    expect(normaliseQuery("about, matrix!")).toBe("matrix!")
  })
})

describe("queryVariants", () => {
  it("returns [] for blank input", () => {
    expect(queryVariants("   ")).toEqual([])
  })

  it("returns the normalised query as a single variant", () => {
    expect(queryVariants("tell me about the matrix")).toEqual(["matrix"])
  })
})
