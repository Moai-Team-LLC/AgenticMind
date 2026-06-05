/**
 * /ask pipeline orchestration. Glues the pieces together:
 * query variants → embed → answer-cache lookup → hybrid retrieval (chunks
 * vector+BM25 blended, recency-boosted) + knowledge cards prepended → prompt →
 * chat → citation parsing → best-effort cache store. Env/DB-coupled; the pure
 * sub-pieces (synth core, blend, recency, cache keys) are unit-tested.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { CardHit } from "@agenticmind/shared/database/query/knowledge/cards"
import type { KnowledgeHit } from "@agenticmind/shared/database/query/knowledge/chunks"
import type { LlmModel } from "@agenticmind/shared/lib/ai/model"
import type { HybridWeights } from "@agenticmind/shared/lib/knowledge/blend"
import type { RecencyConfig } from "@agenticmind/shared/lib/knowledge/recency"
import type {
  Answer,
  GraphContextRow,
  CallerContext,
  Source,
} from "@agenticmind/shared/lib/knowledge/synth"

import {
  lookupAnswer,
  storeAnswer,
} from "@agenticmind/shared/database/query/knowledge/answer-cache"
import { recordAskTelemetry } from "@agenticmind/shared/database/query/knowledge/ask-telemetry"
import { searchCards, searchCardsBm25 } from "@agenticmind/shared/database/query/knowledge/cards"
import { searchChunks, searchChunksBm25 } from "@agenticmind/shared/database/query/knowledge/chunks"
import { getMaterial } from "@agenticmind/shared/database/query/knowledge/materials"
import {
  fingerprintSources,
  hashQuestion,
} from "@agenticmind/shared/lib/knowledge/answer-cache-keys"
import { blendHybrid, clamp01, defaultHybridWeights } from "@agenticmind/shared/lib/knowledge/blend"
import {
  classifyComplexity,
  modelForComplexity,
} from "@agenticmind/shared/lib/knowledge/complexity"
import { scoreFaithfulness } from "@agenticmind/shared/lib/knowledge/faithfulness"
import { detectOutputLeak } from "@agenticmind/shared/lib/knowledge/guard"
import { completeKnowledge, embedKnowledgeText } from "@agenticmind/shared/lib/knowledge/llm"
import {
  CARD_WEIGHT_BOOST,
  RETRIEVAL_MIN_CONFIDENCE,
} from "@agenticmind/shared/lib/knowledge/ontology"
import { boost, defaultRecencyConfig } from "@agenticmind/shared/lib/knowledge/recency"
import { rerankPairs } from "@agenticmind/shared/lib/knowledge/rerank"
import { queryVariants } from "@agenticmind/shared/lib/knowledge/stopwords"
import {
  buildPromptWithGraphContext,
  buildSystemPromptWithContext,
  classifyServedBy,
  DEFAULT_TOP_K,
  MAX_CARD_SOURCES,
  MAX_GRAPH_CONTEXT_ROWS,
  parseCitations,
  SERVED_BY_CACHE,
  SOURCE_ORIGIN_CARD,
  SOURCE_ORIGIN_CHUNK,
} from "@agenticmind/shared/lib/knowledge/synth"
import {
  Attr,
  recordChildSpan,
  setInput,
  setOutput,
  SpanKind,
  withSpan,
} from "@agenticmind/shared/lib/observability/trace"
import { okAsync, ResultAsync } from "neverthrow"

export type AskError = { readonly type: "ask_error"; readonly message: string }
const askError = (message: string): AskError => {
  return { type: "ask_error", message }
}

export type AskProps = {
  tx: Transaction
  question: string
  /** Asker id, recorded on the telemetry row (nullable). */
  memberId?: string | null
  memberContext?: CallerContext | null
  cardsEnabled?: boolean
  cacheEnabled?: boolean
  topK?: number
  chatModel?: LlmModel
  /** Hybrid vector/BM25 fusion weights; defaults to the engine default. Tunable per corpus. */
  hybridWeights?: HybridWeights
  /** Recency-boost config applied to chunk scores; defaults to the engine default. Tunable. */
  recencyConfig?: RecencyConfig
  /** Rerank pool size (top-N kept by the cross-encoder); defaults to topK. */
  rerankTopN?: number
  /** Optional Tier-2 graph-context provider (best-effort). */
  graphContext?: (question: string, queryEmbedding: number[]) => Promise<GraphContextRow[]>
}

type MatMeta = { title: string; updatedAt: Date | null }

const resolveMeta = async (
  tx: Transaction,
  materialId: string,
  cache: Map<string, MatMeta>,
): Promise<MatMeta> => {
  const cached = cache.get(materialId)
  if (cached !== undefined) {
    return cached
  }
  const res = await getMaterial({ tx, id: materialId })
  const meta: MatMeta =
    res.isOk() && res.value !== null
      ? { title: res.value.title, updatedAt: res.value.updatedAt }
      : { title: "", updatedAt: null }
  cache.set(materialId, meta)
  return meta
}

/** Decorate chunk hits with title + recency-boosted score, sorted + renumbered. */
const decorate = async (
  tx: Transaction,
  hits: KnowledgeHit[],
  cache: Map<string, MatMeta>,
  cfg: RecencyConfig,
): Promise<Source[]> => {
  const sources: Source[] = []
  for (const h of hits) {
    const meta = await resolveMeta(tx, h.materialId, cache)
    sources.push({
      number: 0,
      chunkId: h.chunkId,
      materialId: h.materialId,
      title: meta.title,
      body: h.body,
      score: boost(h.score, meta.updatedAt, cfg),
      updatedAt: meta.updatedAt,
      origin: SOURCE_ORIGIN_CHUNK,
    })
  }
  sources.sort((a, b) => b.score - a.score)
  for (const [i, s] of sources.entries()) {
    s.number = i + 1
  }
  return sources
}

/** Hybrid-blend cards (with CardWeightBoost), return up to MAX_CARD_SOURCES as Sources. */
const fetchCardSources = async (
  props: AskProps,
  queryEmbedding: number[],
  variants: string[],
  cache: Map<string, MatMeta>,
): Promise<Source[]> => {
  const pool = Math.max(MAX_CARD_SOURCES, Math.min((props.topK ?? DEFAULT_TOP_K) * 2, 20))
  const w = props.hybridWeights ?? defaultHybridWeights()
  const vec = await searchCards({
    tx: props.tx,
    queryEmbedding,
    limit: pool,
    minConfidence: RETRIEVAL_MIN_CONFIDENCE,
  })
  const bm = await searchCardsBm25({
    tx: props.tx,
    query: props.question,
    variants,
    limit: pool,
    minConfidence: RETRIEVAL_MIN_CONFIDENCE,
  })
  const byId = new Map<string, { hit: CardHit; score: number }>()
  if (vec.isOk()) {
    for (const h of vec.value) {
      byId.set(h.cardId, { hit: h, score: w.vector * clamp01(h.score) * CARD_WEIGHT_BOOST })
    }
  }
  if (bm.isOk()) {
    for (const h of bm.value) {
      const add = w.bm25 * clamp01(h.score) * CARD_WEIGHT_BOOST
      const existing = byId.get(h.cardId)
      if (existing !== undefined) {
        existing.score += add
      } else {
        byId.set(h.cardId, { hit: h, score: add })
      }
    }
  }
  if (byId.size === 0) {
    return []
  }
  const ranked = [...byId.values()].toSorted((a, b) => b.score - a.score).slice(0, MAX_CARD_SOURCES)

  const out: Source[] = []
  for (const { hit, score } of ranked) {
    const meta = await resolveMeta(props.tx, hit.materialId, cache)
    out.push({
      number: 0,
      chunkId: hit.cardId, // Overload: card id in the chunk-id slot for the prompt path
      materialId: hit.materialId,
      title: meta.title,
      body: hit.body,
      score,
      updatedAt: meta.updatedAt,
      origin: SOURCE_ORIGIN_CARD,
      spanStart: hit.spanStart,
      spanEnd: hit.spanEnd,
      confidence: hit.confidence,
    })
  }
  return out
}

const runAsk = async (props: AskProps): Promise<Answer> => {
  const question = props.question.trim()
  if (question === "") {
    throw askError("empty question")
  }
  const topK = props.topK !== undefined && props.topK > 0 ? props.topK : DEFAULT_TOP_K
  const t0 = Date.now()
  const phases: { phase: string; ms: number }[] = []
  const mark = (phase: string, since: number): void => {
    phases.push({ phase, ms: Date.now() - since })
  }

  let ts = Date.now()
  const variants = queryVariants(question)
  const embedQuery = variants.length > 0 ? variants.join(" ") : question
  const embedded = await embedKnowledgeText(embedQuery)
  if (embedded.isErr()) {
    throw askError(`embed: ${embedded.error.message}`)
  }
  const queryVec = embedded.value
  mark("embed", ts)

  // Tier-1: answer-cache lookup (best-effort early return).
  ts = Date.now()
  if (props.cacheEnabled === true) {
    const cached = await lookupAnswer({ tx: props.tx, question, queryEmbedding: queryVec })
    if (cached.isOk() && cached.value !== null) {
      mark("cache_hit", ts)
      // Cached answers always carry >=1 citation (the store gate); recompute the
      // pure Tier-A faithfulness signals so a cache hit is indistinguishable from
      // a fresh answer to the caller.
      const faith = scoreFaithfulness(
        cached.value.answerText,
        cached.value.citations,
        cached.value.citations.length,
      )
      return {
        answer: cached.value.answerText,
        citations: cached.value.citations,
        retrievalMs: Date.now() - t0,
        generationMs: 0,
        model: cached.value.answerModel,
        servedBy: SERVED_BY_CACHE,
        phases,
        groundedness: faith.groundedness,
        unsupportedClaims: faith.unsupportedClaims,
        abstained: faith.abstained,
      }
    }
    if (cached.isErr()) {
      console.warn(`ask: cache lookup failed: ${cached.error.message}`)
    }
  }
  mark("cache_miss", ts)

  // Hybrid retrieval over chunks.
  ts = Date.now()
  const retrieveStartMs = ts
  const pool = Math.max(topK, Math.min(topK * 3, 30))
  const vectorHits = await searchChunks({ tx: props.tx, queryEmbedding: queryVec, limit: pool })
  if (vectorHits.isErr()) {
    throw askError(`search: ${vectorHits.error.message}`)
  }
  const bm25 = await searchChunksBm25({ tx: props.tx, query: question, variants, limit: pool })
  const bm25Hits = bm25.isOk() ? bm25.value : []
  const fused = blendHybrid(vectorHits.value, bm25Hits, props.hybridWeights ?? defaultHybridWeights())
  const hits = fused.map((f) => {
    return { ...f.hit, score: f.fusedScore }
  })

  const matCache = new Map<string, MatMeta>()
  let sources = await decorate(props.tx, hits, matCache, props.recencyConfig ?? defaultRecencyConfig())

  // Tier-1: prepend knowledge cards ahead of raw chunks.
  if (props.cardsEnabled === true) {
    const cardSources = await fetchCardSources(props, queryVec, variants, matCache)
    if (cardSources.length > 0) {
      sources = [...cardSources, ...sources]
    }
  }
  mark("retrieve", ts)

  // Reranker: narrow the retrieval pool to the top-K the synthesiser sees,
  // Ordered by cross-encoder relevance. Falls back to fused order on failure.
  ts = Date.now()
  let rerankUsed = false
  let rerankLatencyMs: number | undefined
  if (sources.length > topK) {
    const pairs = sources.map((s) => {
      return { body: s.body, item: s }
    })
    const r = await rerankPairs({ query: question, pairs, topN: props.rerankTopN ?? topK }).match(
      (ranked) => {
        return { items: ranked.map((p) => p.item), used: true }
      },
      () => {
        return { items: pairs.map((p) => p.item), used: false }
      },
    )
    sources = r.items.slice(0, topK)
    rerankUsed = r.used
    rerankLatencyMs = Date.now() - ts
  }
  for (const [i, s] of sources.entries()) {
    s.number = i + 1
  }
  mark("rerank", ts)
  recordChildSpan("retrieve", SpanKind.RETRIEVER, retrieveStartMs, Date.now(), {
    [Attr.RETRIEVAL_DOC_COUNT]: sources.length,
  })

  // Tier-2: optional graph-context prelude (best-effort).
  let graphContext: GraphContextRow[] = []
  if (props.graphContext !== undefined) {
    try {
      const rows = await props.graphContext(question, queryVec)
      graphContext = rows.slice(0, MAX_GRAPH_CONTEXT_ROWS)
    } catch (error) {
      console.warn(`ask: graph context failed: ${String(error)}`)
    }
  }

  const retrievalMs = Date.now() - t0
  // Adaptive model routing: simple fact-lookups go to the cheap/fast model,
  // Multi-part / comparative / long questions to the flagship. Caller override wins.
  const model = props.chatModel ?? modelForComplexity(classifyComplexity(question))
  const system = buildSystemPromptWithContext(props.memberContext ?? null)
  ts = Date.now()
  const completion = await completeKnowledge({
    system,
    user: buildPromptWithGraphContext(question, sources, graphContext),
    model,
    purpose: "knowledge ask",
  })
  if (completion.isErr()) {
    throw askError(`chat: ${completion.error.message}`)
  }
  const generationMs = Date.now() - ts
  mark("synth", ts)
  recordChildSpan("synthesize", SpanKind.LLM, ts, ts + generationMs, {
    [Attr.LLM_MODEL]: model,
  })

  // Output guard: a grounded answer must never echo the system prompt. On a
  // Leak we drop the answer (and its citations) for a safe fallback.
  ts = Date.now()
  let answerText = completion.value
  const leak = detectOutputLeak(answerText, system)
  if (leak.leaked) {
    console.warn(`ask: output leak blocked (${leak.reason})`)
    answerText = "I couldn't produce a safe answer for that."
  }
  const citations = leak.leaked ? [] : parseCitations(answerText, sources)
  mark("output_filter", ts)

  // Tier-1: best-effort cache store.
  if (props.cacheEnabled === true && citations.length > 0) {
    const updatedByMat = new Map<string, Date | null>()
    for (const s of sources) {
      updatedByMat.set(s.materialId, s.updatedAt)
    }
    const citedIds = [...new Set(citations.map((c) => c.materialId))]
    const fingerprint = fingerprintSources(
      citedIds.map((id) => {
        return { materialId: id, updatedAt: updatedByMat.get(id) ?? new Date(0) }
      }),
    )
    const stored = await storeAnswer({
      tx: props.tx,
      entry: {
        questionHash: hashQuestion(question),
        questionText: question,
        questionEmbedding: queryVec,
        answerText,
        citations,
        sourceMaterialIds: citedIds,
        sourceFingerprint: fingerprint,
        answerModel: model,
      },
    })
    if (stored.isErr()) {
      console.warn(`ask: cache store failed: ${stored.error.message}`)
    }
  }

  // Tier-A faithfulness: structural groundedness + abstention, computed from the
  // already-parsed citations (no extra LLM call, no added latency).
  const faith = scoreFaithfulness(answerText, citations, sources.length)

  return {
    answer: answerText,
    citations,
    retrievalMs,
    generationMs,
    model,
    servedBy: classifyServedBy(citations, sources),
    graphContextRows: graphContext.length,
    rerankUsed,
    rerankLatencyMs,
    phases,
    groundedness: faith.groundedness,
    unsupportedClaims: faith.unsupportedClaims,
    abstained: faith.abstained,
  }
}

/** `runAsk` wrapped in an OpenInference CHAIN span (a no-op until an exporter is
 * registered). Captures the question, answer, model, served-by, citation count,
 * and the phase timings as span events — the why-trace, portable to any OTel
 * backend (Phoenix / Langfuse / LangSmith). */
const runAskTraced = async (props: AskProps): Promise<Answer> =>
  withSpan("knowledge.ask", SpanKind.CHAIN, async (span) => {
    setInput(span, props.question)
    const answer = await runAsk(props)
    setOutput(span, answer.answer)
    span.setAttribute(Attr.LLM_MODEL, answer.model)
    span.setAttribute(Attr.SERVED_BY, answer.servedBy)
    span.setAttribute(Attr.CITATION_COUNT, answer.citations.length)
    span.setAttribute(Attr.RETRIEVAL_MS, answer.retrievalMs)
    span.setAttribute(Attr.GENERATION_MS, answer.generationMs)
    span.setAttribute(Attr.GROUNDEDNESS, answer.groundedness ?? 1)
    span.setAttribute(Attr.UNSUPPORTED_CLAIM_COUNT, answer.unsupportedClaims?.length ?? 0)
    span.setAttribute(Attr.ABSTAINED, answer.abstained ?? false)
    for (const phase of answer.phases ?? []) {
      span.addEvent(`phase.${phase.phase}`, { ms: phase.ms })
    }
    return answer
  })

/** Runs the full /ask pipeline for one question. */
export const ask = (props: AskProps): ResultAsync<Answer, AskError> =>
  ResultAsync.fromPromise(runAskTraced(props), (e) =>
    e !== null && typeof e === "object" && "type" in e && (e as AskError).type === "ask_error"
      ? (e as AskError)
      : askError(e instanceof Error ? e.message : String(e)),
  ).andThen((answer) =>
    // Best-effort telemetry write — a failure must never degrade the answer.
    // The row id flows back as `telemetryId` so /ask feedback can link to it.
    recordAskTelemetry({
      tx: props.tx,
      event: {
        memberId: props.memberId ?? null,
        questionHash: hashQuestion(props.question),
        servedBy: answer.servedBy,
        retrievalMs: answer.retrievalMs,
        generationMs: answer.generationMs,
        model: answer.model,
        citationCount: answer.citations.length,
        answerChars: answer.answer.length,
        rerankUsed: answer.rerankUsed ?? false,
        rerankLatencyMs: answer.rerankLatencyMs ?? null,
        graphContextRows: answer.graphContextRows ?? 0,
        phases: answer.phases ?? [],
      },
    })
      .map((row): Answer => {
        return { ...answer, telemetryId: row.id }
      })
      .orElse((telemetryError) => {
        console.warn("[Knowledge] ask telemetry write failed", telemetryError)
        return okAsync<Answer, AskError>(answer)
      }),
  )
