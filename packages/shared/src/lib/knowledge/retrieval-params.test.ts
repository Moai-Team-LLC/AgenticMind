import { describe, expect, it } from "vitest"

import type { ScoredParams } from "./retrieval-params"

import { parseRetrievalParams, resolveRetrievalParams, selectBestParams } from "./retrieval-params"

describe("parseRetrievalParams", () => {
  it("accepts a partial profile", () => {
    expect(parseRetrievalParams({ topK: 6 })).toEqual({ topK: 6 })
    expect(parseRetrievalParams({ hybridWeights: { vector: 0.8, bm25: 0.2 } })).toEqual({
      hybridWeights: { vector: 0.8, bm25: 0.2 },
    })
  })

  it("rejects malformed shapes", () => {
    expect(parseRetrievalParams({ topK: -1 })).toBeNull()
    expect(parseRetrievalParams({ hybridWeights: { vector: 0.8 } })).toBeNull()
    expect(parseRetrievalParams("nope")).toBeNull()
  })
})

describe("resolveRetrievalParams", () => {
  it("returns undefined for unset / blank / malformed input", () => {
    const unset: string | undefined = undefined
    expect(resolveRetrievalParams(unset)).toBeUndefined()
    expect(resolveRetrievalParams("")).toBeUndefined()
    expect(resolveRetrievalParams("  ")).toBeUndefined()
    expect(resolveRetrievalParams("{not json")).toBeUndefined()
    expect(resolveRetrievalParams(JSON.stringify({ topK: 0 }))).toBeUndefined()
  })

  it("parses a valid JSON profile", () => {
    expect(resolveRetrievalParams(JSON.stringify({ topK: 10, rerankTopN: 8 }))).toEqual({
      topK: 10,
      rerankTopN: 8,
    })
  })
})

const scored = (
  passRate: number,
  byFailureMode: Record<string, number>,
  topK = 8,
): ScoredParams => {
  return { params: { topK }, passRate, byFailureMode }
}

describe("selectBestParams", () => {
  const active = scored(0.8, { factual: 0.8, grounding: 0.8 }, 8)

  it("picks the best candidate that beats the margin and regresses nothing", () => {
    const winner = selectBestParams(active, [
      scored(0.83, { factual: 0.82, grounding: 0.84 }, 6),
      scored(0.88, { factual: 0.9, grounding: 0.86 }, 12),
    ])
    expect(winner?.passRate).toBe(0.88)
    expect(winner?.params.topK).toBe(12)
  })

  it("rejects a candidate that wins overall but regresses a failure mode", () => {
    const winner = selectBestParams(active, [
      scored(0.9, { factual: 0.99, grounding: 0.5 }, 4), // grounding collapsed
    ])
    expect(winner).toBeNull()
  })

  it("rejects candidates that don't clear the margin", () => {
    const winner = selectBestParams(active, [scored(0.81, { factual: 0.81, grounding: 0.81 })])
    expect(winner).toBeNull()
  })

  it("honors custom margin/tolerance", () => {
    const winner = selectBestParams(active, [scored(0.81, { factual: 0.81, grounding: 0.81 })], {
      margin: 0.005,
    })
    expect(winner?.passRate).toBe(0.81)
  })
})
