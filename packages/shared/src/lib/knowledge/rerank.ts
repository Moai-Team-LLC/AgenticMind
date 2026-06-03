/**
 * Knowledge cross-encoder rerank — thin wrapper over the shared
 * rerankDocuments (native Cohere /v2/rerank by default). Reorders (query, doc) pairs by
 * relevance, mapping the ranking back onto the caller's items. Used to narrow
 * the top-30 retrieval pool to the top-K the synthesiser sees.
 */

import type { RerankModel } from "@agenticmind/shared/lib/ai/model"
import type { ResultAsync } from "neverthrow"

import { rerankDocuments } from "@agenticmind/shared/lib/ai/rerank"
import { aiSettings } from "@agenticmind/shared/settings/ai-settings"
import { errAsync, okAsync } from "neverthrow"

/** Multilingual default — good for a mixed RU/EN corpus (override via RERANK_MODEL). */
export const KNOWLEDGE_RERANK_MODEL: RerankModel = aiSettings.RERANK_MODEL ?? "rerank-v3.5"

export type RerankPair<T> = {
  /** The document text scored against the query. */
  body: string
  /** The caller's item carried through the reorder. */
  item: T
}

/** Loosely-typed rerank failure (the shared layer widens the `type` tag). */
export type RerankError = { readonly type: string; readonly message: string }

/**
 * Returns the pairs reordered by rerank relevance (highest first), dropping
 * any index the reranker omits. Empty input short-circuits to []. On a rerank
 * failure the ResultAsync carries the error so callers can fall back to the
 * original order via `.unwrapOr(pairs)`.
 */
export const rerankPairs = <T>(props: {
  query: string
  pairs: RerankPair<T>[]
  model?: RerankModel
  topN?: number
  purpose?: string
}): ResultAsync<RerankPair<T>[], RerankError> => {
  if (props.pairs.length === 0) {
    return okAsync<RerankPair<T>[], RerankError>([])
  }
  // Off by default: callers fall back to the fused vector+BM25 order. This keeps
  // the zero-key path free of a doomed network call + its retry storm.
  if (aiSettings.RERANK_ENABLED?.toLowerCase() !== "true") {
    return errAsync<RerankPair<T>[], RerankError>({
      type: "rerank_disabled",
      message: "rerank disabled (set RERANK_ENABLED=true to enable)",
    })
  }
  return rerankDocuments({
    model: props.model ?? KNOWLEDGE_RERANK_MODEL,
    query: props.query,
    documents: props.pairs.map((p) => p.body),
    topN: props.topN,
    purpose: props.purpose ?? "knowledge rerank",
  }).map((ranking) =>
    ranking
      .map((r) => props.pairs[r.originalIndex])
      .filter((p): p is RerankPair<T> => p !== undefined),
  )
}
