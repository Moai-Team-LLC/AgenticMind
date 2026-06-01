import { describe, expect, it } from "vitest"

import { CARD_KINDS, isCardKind } from "./card"

describe("card kinds", () => {
  it("freezes the V0 kind vocabulary", () => {
    expect(CARD_KINDS).toEqual(["fact", "qa", "definition", "metric", "procedure", "resolution"])
  })

  it("guards card kinds", () => {
    expect(isCardKind("resolution")).toBe(true)
    expect(isCardKind("opinion")).toBe(false)
  })
})
