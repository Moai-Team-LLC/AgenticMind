/**
 * Indexing pipeline orchestration. For one material:
 * sanitize → chunk → embed (prepareChunkItems, no database) → upsertChunks +
 * status=embedded (persistChunkItems), then card extraction (computeCardItems,
 * no database) → upsertCards (persistCardItems). indexMaterial runs it all in
 * the caller's transaction with best-effort cards, as before; the background
 * ingestion runner calls the same pieces with model calls outside transactions.
 *
 * Env/DB-coupled (embedder + repos), so it's exercised at the worker/tRPC
 * layer rather than unit-tested; the pure pieces (sanitize, chunker, cards
 * validation) have their own tests.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { CardInput } from "@agenticmind/shared/database/query/knowledge/cards"
import type { TabularSchema } from "@agenticmind/shared/lib/knowledge/cards-tabular"
import type { Table } from "@agenticmind/shared/lib/knowledge/extract-tabular"

import { upsertCards } from "@agenticmind/shared/database/query/knowledge/cards"
import { upsertChunks } from "@agenticmind/shared/database/query/knowledge/chunks"
import { updateMaterialStatus } from "@agenticmind/shared/database/query/knowledge/materials"
import {
  admitCards,
  evaluateAcceptance,
} from "@agenticmind/shared/lib/knowledge/acceptance-evaluator"
import {
  dropUngroundedCards,
  extractCards,
} from "@agenticmind/shared/lib/knowledge/cards-extractor"
import { extractFromTables } from "@agenticmind/shared/lib/knowledge/cards-tabular"
import { approxTokens, splitText } from "@agenticmind/shared/lib/knowledge/chunker"
import {
  embedKnowledgeBatch,
  KNOWLEDGE_EMBEDDING_MODEL,
} from "@agenticmind/shared/lib/knowledge/llm"
import { sanitizeForText } from "@agenticmind/shared/lib/knowledge/sanitize"
import { activeProfile, isStrict } from "@agenticmind/shared/lib/profile"
import { ResultAsync } from "neverthrow"

export type IndexError = { readonly type: "index_error"; readonly message: string }

export type IndexMaterialProps = {
  tx: Transaction
  material: { id: string; title: string; ftsConfig?: string }
  body: string
  /** Tabular hints: when schema + tables are set, cards come from rows (no LLM). */
  extras?: { tables?: Table[]; schema?: TabularSchema }
  /** Gate the LLM cards extractor (KNOWLEDGE_CARDS_ENABLED). */
  cardsEnabled?: boolean
  /** Run the acceptance evaluator on extracted cards before storage
   * (KNOWLEDGE_ACCEPTANCE_EVALUATOR). One extra LLM call; default off. */
  acceptanceEvaluator?: boolean
  /** Fail-closed acceptance: a missing verdict or a failed evaluator leaves cards
   * as `candidate` instead of approved. Defaults to the active profile (on in
   * `strict`), so no caller can forget to pass it. */
  acceptanceFailClosed?: boolean
}

const indexError = (message: string): IndexError => {
  return { type: "index_error", message }
}

const markFailed = async (tx: Transaction, id: string, reason: string): Promise<void> => {
  await updateMaterialStatus({ tx, id, status: "failed", errorMessage: reason })
}

/** A card ready to store; CardInput already carries the optional embedding. */
export type CardItem = CardInput

export type CardItemsResult = { ok: true; items: CardItem[] } | { ok: false; reason: string }

export type ComputeCardItemsProps = {
  material: { id: string; title: string }
  body: string
  extras?: IndexMaterialProps["extras"]
  cardsEnabled?: boolean
  acceptanceEvaluator?: boolean
  acceptanceFailClosed?: boolean
  /** Card extractor; defaults to the LLM extractor. Injected by tests. */
  extract?: typeof extractCards
  /** Embedder for card bodies; defaults to the knowledge embedder. */
  embed?: typeof embedKnowledgeBatch
  /** Aborts the extraction (e.g. a request deadline). */
  abortSignal?: AbortSignal
}

/**
 * Extract → ground → admit → embed card items. Touches no database, so a job can
 * run it outside any transaction. `ok: false` when the extraction itself failed
 * (retryable); an empty list when there is nothing to store.
 */
export const computeCardItems = async (props: ComputeCardItemsProps): Promise<CardItemsResult> => {
  const { material, extras, cardsEnabled, body } = props
  let items: CardInput[] = []
  if (extras?.schema !== undefined && extras.tables !== undefined && extras.tables.length > 0) {
    items = extractFromTables(extras.tables, extras.schema)
  } else if (cardsEnabled === true) {
    const extract = props.extract ?? extractCards
    const extracted = await extract({
      materialTitle: material.title,
      body,
      abortSignal: props.abortSignal,
    })
    if (extracted.isErr()) {
      return { ok: false, reason: extracted.error.message }
    }
    // Deterministic grounding filter: drop LLM-extracted cards asserting a figure
    // absent from the source text (a fabricated/garbled number would otherwise be
    // stored and later surface as a card-backed answer). Tabular cards skip this.
    const grounded = dropUngroundedCards(extracted.value, body)
    if (grounded.dropped.length > 0) {
      console.warn(
        `index: dropped ${grounded.dropped.length} ungrounded card(s) for ${material.id}: ${grounded.dropped.join(", ")}`,
      )
    }
    items = grounded.kept
  }
  if (items.length === 0) {
    return { ok: true, items: [] }
  }

  // Acceptance gate (KU contract, 2nd stage): drop rejected noise + status-tag
  // the rest before embedding/storage. A judge failure keeps the extracted
  // items as-is (born approved at the DB) — or, fail-closed (strict), keeps
  // them as candidates with the failure recorded.
  if (props.acceptanceEvaluator === true) {
    const failClosed = props.acceptanceFailClosed ?? isStrict(activeProfile())
    const judged = await evaluateAcceptance(items, { failClosed })
    if (judged.isErr()) {
      console.warn(
        `index: acceptance evaluator failed for ${material.id}: ${judged.error.message}${failClosed ? " (cards kept as candidates)" : ""}`,
      )
    }
    items = admitCards(items, judged, { failClosed })
    if (items.length === 0) {
      return { ok: true, items: [] }
    }
  }

  const embed = props.embed ?? embedKnowledgeBatch
  const embedded = await embed(items.map((c) => c.body))
  const vectors = embedded.isOk() ? embedded.value : null
  if (vectors === null) {
    console.warn(`index: cards embed failed for ${material.id} (persisting BM25-only)`)
  }
  return {
    ok: true,
    items: items.map((c, k) =>
      vectors !== null && vectors[k] !== undefined
        ? { ...c, embedding: vectors[k], embeddingModel: KNOWLEDGE_EMBEDDING_MODEL }
        : c,
    ),
  }
}

/** Replaces a material's cards with `items` (idempotent per material). */
export const persistCardItems = async (
  tx: Transaction,
  material: { id: string; ftsConfig?: string },
  items: CardItem[],
): Promise<void> => {
  if (items.length === 0) {
    return
  }
  const upserted = await upsertCards({
    tx,
    materialId: material.id,
    items,
    ftsConfig: material.ftsConfig,
  })
  if (upserted.isErr()) {
    throw indexError(`cards upsert: ${upserted.error.message}`)
  }
}

/**
 * Best-effort card extraction + embed + upsert. Never throws — failures are
 * logged and the material stays vector-searchable via chunks alone.
 */
const runCardExtraction = async (props: IndexMaterialProps, body: string): Promise<void> => {
  const { tx, material } = props
  try {
    const computed = await computeCardItems({ ...props, body })
    if (!computed.ok) {
      console.warn(`index: cards extract failed for ${material.id}: ${computed.reason}`)
      return
    }
    await persistCardItems(tx, material, computed.items)
  } catch (error) {
    console.warn(`index: card extraction crashed for ${material.id}: ${String(error)}`)
  }
}

export type ChunkItem = {
  ordinal: number
  body: string
  tokenCount: number
  embedding: number[] | null
  embeddingModel: string
}

/** Thrown when there is nothing to index; permanent, never worth a retry. */
export const EMPTY_BODY_PREFIX = "empty:"

/**
 * Sanitize → chunk → embed. Touches no database, so a job (or a request racing
 * its deadline) can run it outside a transaction and persist afterwards.
 */
export const prepareChunkItems = async (
  rawBody: string,
  embed: typeof embedKnowledgeBatch = embedKnowledgeBatch,
): Promise<{ body: string; items: ChunkItem[] }> => {
  const body = sanitizeForText(rawBody).trim()
  if (body === "") {
    throw indexError(
      `${EMPTY_BODY_PREFIX} ${
        rawBody.length > 0
          ? "extracted text was empty (likely a scan-only PDF — needs OCR)"
          : "empty body"
      }`,
    )
  }
  const pieces = splitText(body)
  if (pieces.length === 0) {
    throw indexError(`${EMPTY_BODY_PREFIX} chunker produced 0 chunks`)
  }
  const embedded = await embed(pieces)
  if (embedded.isErr()) {
    throw indexError(`embed: ${embedded.error.message}`)
  }
  const vectors = embedded.value
  if (vectors.length !== pieces.length) {
    throw indexError(`embedder returned ${vectors.length} vectors for ${pieces.length} pieces`)
  }
  return {
    body,
    items: pieces.map((piece, k) => {
      return {
        ordinal: k,
        body: piece,
        tokenCount: approxTokens(piece),
        embedding: vectors[k] ?? null,
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
      }
    }),
  }
}

/** Replaces a material's passages with `items` and marks it embedded. */
export const persistChunkItems = async (
  tx: Transaction,
  material: { id: string; ftsConfig?: string },
  items: ChunkItem[],
): Promise<void> => {
  const persisted = await upsertChunks({
    tx,
    materialId: material.id,
    items,
    ftsConfig: material.ftsConfig,
  })
  if (persisted.isErr()) {
    throw indexError(`persist: ${persisted.error.message}`)
  }
  const status = await updateMaterialStatus({ tx, id: material.id, status: "embedded" })
  if (status.isErr()) {
    throw indexError(`status→embedded: ${status.error.message}`)
  }
}

const runIndex = async (props: IndexMaterialProps): Promise<{ chunkCount: number }> => {
  const { tx, material } = props
  // The whole pipeline runs in the caller's transaction, so the intermediate
  // statuses are never visible outside it; the material ends embedded or failed.
  let prepared: Awaited<ReturnType<typeof prepareChunkItems>>
  try {
    prepared = await prepareChunkItems(props.body)
  } catch (error) {
    const message = errorMessage(error)
    await markFailed(tx, material.id, message.replace(EMPTY_BODY_PREFIX, "").trim())
    throw indexError(`${message} for material ${material.id}`)
  }
  try {
    await persistChunkItems(tx, material, prepared.items)
  } catch (error) {
    await markFailed(tx, material.id, errorMessage(error))
    throw error
  }

  // Best-effort Tier-1 cards. Skip graphrag for tabular materials (handled
  // Separately). Graph extraction is wired in a later brick.
  await runCardExtraction(props, prepared.body)

  return { chunkCount: prepared.items.length }
}

const errorMessage = (error: unknown): string =>
  error !== null && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error)

/** Runs the full indexing pipeline for one material. */
export const indexMaterial = (
  props: IndexMaterialProps,
): ResultAsync<{ chunkCount: number }, IndexError> =>
  ResultAsync.fromPromise(runIndex(props), (e) =>
    e !== null && typeof e === "object" && "type" in e && (e as IndexError).type === "index_error"
      ? (e as IndexError)
      : indexError(e instanceof Error ? e.message : String(e)),
  )
