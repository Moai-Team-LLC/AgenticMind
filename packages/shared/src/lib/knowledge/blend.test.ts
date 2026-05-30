import { describe, expect, it } from "vitest"

import { blendHybrid, clamp01, defaultHybridWeights } from "./blend"

describe("clamp01", () => {
  it("clamps to [0, 1]", () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(1.5)).toBe(1)
    expect(clamp01(0.3)).toBeCloseTo(0.3)
  })
})

describe("blendHybrid", () => {
  it("fuses per chunk and sorts by fused score descending", () => {
    const vector = [
      { chunkId: "a", score: 0.8 },
      { chunkId: "b", score: 0.4 },
    ]
    const bm25 = [
      { chunkId: "b", score: 1.0 },
      { chunkId: "c", score: 0.6 },
    ]
    const out = blendHybrid(vector, bm25, defaultHybridWeights())

    expect(out.map((h) => h.hit.chunkId)).toEqual(["b", "a", "c"])
    // b: 0.7*0.4 + 0.3*1.0 = 0.58 ; a: 0.7*0.8 = 0.56 ; c: 0.3*0.6 = 0.18
    expect(out[0]?.fusedScore).toBeCloseTo(0.58)
    expect(out[1]?.fusedScore).toBeCloseTo(0.56)
    // BM25-only hits report vectorScore 0
    expect(out.find((h) => h.hit.chunkId === "c")?.vectorScore).toBe(0)
  })
})
