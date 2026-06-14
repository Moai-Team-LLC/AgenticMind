import { describe, expect, it } from "vitest"

import { isLayerEnabled, KNOWLEDGE_LAYERS, smokeCheckableLayers } from "./layers"

const byId = (id: string) => {
  const l = KNOWLEDGE_LAYERS.find((x) => x.id === id)
  if (l === undefined) {
    throw new Error(`no layer ${id}`)
  }
  return l
}

describe("layer manifest", () => {
  it("default-off layers enable only on explicit true", () => {
    const cache = byId("answer_cache")
    expect(isLayerEnabled(cache, {})).toBe(false)
    expect(isLayerEnabled(cache, { KNOWLEDGE_CACHE_ENABLED: "true" })).toBe(true)
    expect(isLayerEnabled(cache, { KNOWLEDGE_CACHE_ENABLED: "1" })).toBe(false)
  })

  it("default-on layers disable only on explicit false", () => {
    const pii = byId("pii_redaction")
    expect(isLayerEnabled(pii, {})).toBe(true)
    expect(isLayerEnabled(pii, { KNOWLEDGE_PII_REDACTION: "false" })).toBe(false)
  })

  it("fired predicates read the right answer signal", () => {
    expect(byId("answer_cache").firedFromAnswer?.({ servedBy: "cache" })).toBe(true)
    expect(byId("knowledge_cards").firedFromAnswer?.({ servedBy: "card_synth" })).toBe(true)
    expect(byId("contested_sources").firedFromAnswer?.({ contestedCount: 2 })).toBe(true)
    expect(byId("reranker").firedFromAnswer?.({ rerankUsed: true })).toBe(true)
    expect(byId("faithfulness_tier_b").firedFromAnswer?.({ semanticGroundedness: 0.8 })).toBe(true)
    expect(byId("contested_sources").firedFromAnswer?.({ contestedCount: 0 })).toBe(false)
  })

  it("graphrag (experimental) fires only when the graph contributed context rows", () => {
    const graphrag = byId("graphrag")
    expect(isLayerEnabled(graphrag, {})).toBe(false)
    expect(isLayerEnabled(graphrag, { KNOWLEDGE_GRAPHRAG_ENABLED: "true" })).toBe(true)
    expect(graphrag.firedFromAnswer?.({ graphContextRows: 3 })).toBe(true)
    // The enabled-but-dead state (empty graph from a strict-schema extractor): 0 rows.
    expect(graphrag.firedFromAnswer?.({ graphContextRows: 0 })).toBe(false)
    expect(graphrag.firedFromAnswer?.({})).toBe(false)
  })

  it("smoke set = enabled layers with an observable predicate", () => {
    const env = { KNOWLEDGE_CACHE_ENABLED: "true", RERANK_ENABLED: "true" }
    const ids = smokeCheckableLayers(env).map((l) => l.id)
    expect(ids).toContain("answer_cache")
    expect(ids).toContain("reranker")
    // pii_redaction is default-on (enabled) but has a null predicate → excluded
    expect(ids).not.toContain("pii_redaction")
    expect(ids).not.toContain("acceptance_evaluator") // not enabled + null predicate
  })
})
