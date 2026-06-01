/**
 * Hybrid retrieval blend — ported from services/knowledge/internal/index
 * (blend.go). Merges vector + BM25 result lists with an absolute-scale
 * weighted sum (deliberately NOT RRF and NOT per-list max-normalisation,
 * which inflated weak cosines and broke the downstream 0..1 score threshold).
 */

export type HybridWeights = {
  vector: number
  bm25: number
}

/** Production blend: vector-heavy (semantic recall dominates). */
export const defaultHybridWeights = (): HybridWeights => {
  return { vector: 0.7, bm25: 0.3 }
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : Math.min(1, v))

/** Minimal shape blendHybrid needs; the index repo's Hit type extends this. */
export type ScoredHit = {
  chunkId: string
  score: number
}

export type HybridHit<H extends ScoredHit> = {
  hit: H
  fusedScore: number
  /** 0 for BM25-only hits. */
  vectorScore: number
}

/**
 * Fused = w.vector * clamp01(vectorScore) + w.bm25 * clamp01(bm25Score),
 * summed per chunk across both lists, sorted by fused score descending
 * (stable). pgvector cosine is already [0,1]; ts_rank_cd is clamped at 1.
 */
export const blendHybrid = <H extends ScoredHit>(
  vector: H[],
  bm25: H[],
  w: HybridWeights,
): HybridHit<H>[] => {
  const byChunk = new Map<string, HybridHit<H>>()

  for (const h of vector) {
    byChunk.set(h.chunkId, {
      hit: h,
      fusedScore: w.vector * clamp01(h.score),
      vectorScore: h.score,
    })
  }
  for (const h of bm25) {
    const bm25Component = w.bm25 * clamp01(h.score)
    const existing = byChunk.get(h.chunkId)
    if (existing === undefined) {
      byChunk.set(h.chunkId, { hit: h, fusedScore: bm25Component, vectorScore: 0 })
      continue
    }
    existing.fusedScore += bm25Component
  }

  // Array.sort is stable in modern engines; ties keep insertion (vector-first) order.
  return [...byChunk.values()].toSorted((a, b) => b.fusedScore - a.fusedScore)
}
