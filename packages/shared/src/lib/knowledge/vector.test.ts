import { describe, expect, it } from "vitest"

import { toVectorLiteral } from "./vector"

describe("toVectorLiteral", () => {
  it("renders a pgvector text literal", () => {
    expect(toVectorLiteral([0.1, 0.2, -0.3])).toBe("[0.1,0.2,-0.3]")
  })

  it("renders an empty vector", () => {
    expect(toVectorLiteral([])).toBe("[]")
  })
})
