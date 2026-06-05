/**
 * Corpus-adaptive retrieval tuning (Lever 3.2/3.3) — the data model + the pure
 * decision logic. A *retrieval profile* is a subset of the injectable knobs the
 * ask pipeline exposes (see AskProps in `ask.ts`): hybrid fusion weights, the
 * recency-boost config, top-K, and the rerank pool. An operator (or the
 * `scripts/tune.ts` tuner) supplies an active profile via the `RETRIEVAL_PARAMS`
 * env value (JSON); the server loads it once and threads it into every
 * `kl_ask_global`. Unset ⇒ the engine defaults (zero behaviour change).
 *
 * This module is pure (no DB / env access). The closed loop is: real signals +
 * the eval harness pick the profile that best fits THIS corpus, making the
 * "compounds" promise true on the read path, not just the write path.
 */

import * as z from "zod"

/** A tuned retrieval profile — every field optional; an unset field falls back to the engine default. */
export const retrievalParamsSchema = z.object({
  hybridWeights: z.object({ vector: z.number(), bm25: z.number() }).optional(),
  recencyConfig: z
    .object({
      maxBoost: z.number(),
      fullBoostDays: z.number(),
      zeroBoostDays: z.number(),
    })
    .optional(),
  topK: z.number().int().positive().max(50).optional(),
  rerankTopN: z.number().int().positive().max(50).optional(),
})

export type RetrievalParams = z.infer<typeof retrievalParamsSchema>

/** Validate an already-parsed value into a profile; null when it doesn't fit the schema. */
export const parseRetrievalParams = (raw: unknown): RetrievalParams | null => {
  const r = retrievalParamsSchema.safeParse(raw)
  return r.success ? r.data : null
}

/**
 * Resolve the `RETRIEVAL_PARAMS` env value (a JSON string) into a profile.
 * Unset / blank / malformed JSON / schema-invalid all collapse to `undefined`
 * (use defaults) — a bad config must never crash the server or silently apply a
 * partial profile.
 */
export const resolveRetrievalParams = (raw: string | undefined | null): RetrievalParams | undefined => {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  return parseRetrievalParams(parsed) ?? undefined
}

/** One candidate profile and the eval outcome it produced. */
export type ScoredParams = {
  params: RetrievalParams
  passRate: number
  /** Per-failure-mode pass rate (mode → rate), as produced by the eval harness. */
  byFailureMode: Record<string, number>
}

export type SelectOptions = {
  /** A candidate must beat the active pass rate by at least this much. */
  margin?: number
  /** No failure mode may drop more than this below the active's rate for that mode. */
  perModeTolerance?: number
}

/**
 * Pick the best candidate profile that (1) beats the active profile's overall
 * pass rate by > `margin` AND (2) regresses no failure mode below the active's
 * per-mode rate (minus `perModeTolerance`). Returns null when nothing clears the
 * bar — the tuner must never ship a non-improvement or a quiet regression.
 */
export const selectBestParams = (
  active: ScoredParams,
  candidates: readonly ScoredParams[],
  options: SelectOptions = {},
): ScoredParams | null => {
  const margin = options.margin ?? 0.02
  const perModeTolerance = options.perModeTolerance ?? 0.02

  let best: ScoredParams | null = null
  for (const candidate of candidates) {
    if (candidate.passRate < active.passRate + margin) {
      continue
    }
    const regresses = Object.entries(active.byFailureMode).some(([mode, activeRate]) => {
      const candidateRate = candidate.byFailureMode[mode]
      return candidateRate !== undefined && candidateRate < activeRate - perModeTolerance
    })
    if (regresses) {
      continue
    }
    if (best === null || candidate.passRate > best.passRate) {
      best = candidate
    }
  }
  return best
}
