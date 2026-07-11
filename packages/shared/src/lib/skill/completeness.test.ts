import { describe, expect, it } from "vitest"

import { completenessReport } from "./completeness"

describe("completenessReport (§4 recall metric)", () => {
  it("scores 1.0 when nothing is missed", () => {
    const r = completenessReport(3, [])
    expect(r.completenessScore).toBe(1)
    expect(r.passed).toBe(true)
  })

  it("scores captured / (captured + missed)", () => {
    const r = completenessReport(3, [
      { text: "x", chunk: 1 },
      { text: "y", chunk: 2 },
    ])
    expect(r.completenessScore).toBe(0.6) // 3 / 5
  })

  it("is advisory by default (threshold 0 always passes) but enforces a set threshold", () => {
    const missed = [{ text: "x", chunk: 1 }]
    expect(completenessReport(3, missed).passed).toBe(true) // 0.75 >= 0 (advisory)
    expect(completenessReport(3, missed, 0.9).passed).toBe(false) // 0.75 < 0.9 (enforced)
  })

  it("caps the missed list at 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => {
      return { text: `m${i}`, chunk: 1 }
    })
    expect(completenessReport(0, many).missed).toHaveLength(10)
  })

  it("scores 1.0 when there is nothing to judge", () => {
    expect(completenessReport(0, []).completenessScore).toBe(1)
  })
})
