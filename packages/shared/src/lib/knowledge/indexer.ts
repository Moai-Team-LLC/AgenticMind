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
import type { DialogueSegment } from "@agenticmind/shared/lib/knowledge/chunker"
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
import { approxTokens, splitSegments, splitText } from "@agenticmind/shared/lib/knowledge/chunker"
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

export type CardCoverage = {
  processedChars: number
  totalChars: number
  windows: number
  failedWindows: number
}

export type CardItemsResult =
  | { ok: true; items: CardItem[]; coverage?: CardCoverage }
  | { ok: false; reason: string; coverage?: CardCoverage }

/** Largest window the extractor reads in one call (below CARDS_MAX_BODY_CHARS). */
export const CARD_WINDOW_CHARS = 14_000
/** Characters each window shares with the next, so a fact on a seam is seen whole. */
export const CARD_WINDOW_OVERLAP = 1000
/** Upper bound on cards kept for one document, across all windows. */
export const MAX_CARDS_PER_DOCUMENT = 300

export type CardWindow = { start: number; end: number; text: string }

/**
 * Line-aligned windows over the whole body: each at most `size` characters
 * (a single longer line is cut), consecutive windows sharing about `overlap`
 * characters. Offsets are string indices into `body`.
 */
export const cardWindows = (
  body: string,
  size: number = CARD_WINDOW_CHARS,
  overlap: number = CARD_WINDOW_OVERLAP,
): CardWindow[] => {
  if (body.length <= size) {
    return body === "" ? [] : [{ start: 0, end: body.length, text: body }]
  }
  const out: CardWindow[] = []
  let start = 0
  while (start < body.length) {
    let end = Math.min(body.length, start + size)
    if (end < body.length) {
      const cut = body.lastIndexOf("\n", end)
      if (cut > start + overlap) {
        end = cut + 1
      }
    }
    out.push({ start, end, text: body.slice(start, end) })
    if (end >= body.length) {
      break
    }
    let next = Math.max(start + 1, end - overlap)
    const line = body.indexOf("\n", next)
    if (line !== -1 && line + 1 < end) {
      next = line + 1
    }
    start = next
  }
  return out
}

const cardKey = (c: CardInput): string => {
  const structured = c.predicate !== null && c.predicate !== undefined && c.predicate !== ""
  return [
    c.kind,
    c.subjectType,
    c.subjectValue,
    c.predicate ?? "",
    c.value ?? "",
    structured ? "" : c.body,
  ]
    .map((part) => part.trim().toLowerCase())
    .join("\u0000")
}

/** Length of the union of [start, end) intervals. */
const coveredChars = (intervals: { start: number; end: number }[]): number => {
  const sorted = intervals.toSorted((a, b) => a.start - b.start)
  let total = 0
  let reach = -1
  for (const iv of sorted) {
    if (iv.end <= reach) {
      continue
    }
    total += iv.end - Math.max(iv.start, reach)
    reach = iv.end
  }
  return total
}

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
  /** Keep the cards of the windows that succeeded when others failed. */
  acceptPartial?: boolean
}

/**
 * Extract → ground → admit → embed card items. Touches no database, so a job can
 * run it outside any transaction. `ok: false` when the extraction itself failed
 * (retryable); an empty list when there is nothing to store.
 */
export const computeCardItems = async (props: ComputeCardItemsProps): Promise<CardItemsResult> => {
  const { material, extras, cardsEnabled, body } = props
  let items: CardInput[] = []
  let coverage: CardCoverage | undefined
  if (extras?.schema !== undefined && extras.tables !== undefined && extras.tables.length > 0) {
    items = extractFromTables(extras.tables, extras.schema)
  } else if (cardsEnabled === true) {
    const windowed = await extractWindows(props, body)
    coverage = windowed.coverage
    if (!windowed.ok) {
      return { ok: false, reason: windowed.reason, coverage }
    }
    items = windowed.items
  }
  if (items.length === 0) {
    return { ok: true, items: [], coverage }
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
      return { ok: true, items: [], coverage }
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
    coverage,
    items: items.map((c, k) =>
      vectors !== null && vectors[k] !== undefined
        ? { ...c, embedding: vectors[k], embeddingModel: KNOWLEDGE_EMBEDDING_MODEL }
        : c,
    ),
  }
}

type WindowedCards =
  | { ok: true; items: CardInput[]; coverage: CardCoverage }
  | { ok: false; reason: string; coverage: CardCoverage }

const shiftSpan = (v: number | null | undefined, by: number): number | null | undefined =>
  v === null || v === undefined ? v : v + by

/**
 * Card extraction over the whole body, window by window (cardWindows): each
 * window's cards are grounded against that window, their spans moved to body
 * offsets, and duplicates across windows merged (highest confidence wins).
 * A failed window fails the whole extraction unless `acceptPartial` — then the
 * other windows' cards are kept and `coverage.failedWindows` says what is
 * missing.
 */
const extractWindows = async (
  props: ComputeCardItemsProps,
  body: string,
): Promise<WindowedCards> => {
  const extract = props.extract ?? extractCards
  const windows = cardWindows(body)
  const merged = new Map<string, CardInput>()
  const done: CardWindow[] = []
  const failures: string[] = []
  for (const w of windows) {
    const extracted = await extract({
      materialTitle: props.material.title,
      body: w.text,
      abortSignal: props.abortSignal,
    })
    if (extracted.isErr()) {
      failures.push(extracted.error.message)
      continue
    }
    done.push(w)
    // Deterministic grounding filter: drop LLM-extracted cards asserting a figure
    // absent from the source text (a fabricated/garbled number would otherwise be
    // stored and later surface as a card-backed answer). Tabular cards skip this.
    const grounded = dropUngroundedCards(extracted.value, w.text)
    if (grounded.dropped.length > 0) {
      console.warn(
        `index: dropped ${grounded.dropped.length} ungrounded card(s) for ${props.material.id}: ${grounded.dropped.join(", ")}`,
      )
    }
    for (const card of grounded.kept) {
      const shifted = {
        ...card,
        spanStart: shiftSpan(card.spanStart, w.start),
        spanEnd: shiftSpan(card.spanEnd, w.start),
      }
      const key = cardKey(card)
      const prior = merged.get(key)
      if (prior === undefined || shifted.confidence > prior.confidence) {
        merged.set(key, shifted)
      }
    }
  }
  const coverage: CardCoverage = {
    processedChars: coveredChars(done),
    totalChars: body.length,
    windows: windows.length,
    failedWindows: failures.length,
  }
  if (failures.length > 0 && (props.acceptPartial !== true || done.length === 0)) {
    return {
      ok: false,
      reason: `${failures.length} of ${windows.length} window(s) failed: ${failures[0] ?? ""}`,
      coverage,
    }
  }
  const items = [...merged.values()]
    .toSorted((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_CARDS_PER_DOCUMENT)
  return { ok: true, items, coverage }
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
    const computed = await computeCardItems({ ...props, body, acceptPartial: true })
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
  segmentFrom?: number | null
  segmentTo?: number | null
  startMs?: number | null
  endMs?: number | null
  speaker?: string | null
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

/**
 * A dialogue's passages along utterance boundaries (splitSegments), embedded.
 * Each passage records the utterances and time span it covers, so a citation
 * can name the utterance and the moment.
 */
export const prepareDialogueChunkItems = async (
  segments: readonly DialogueSegment[],
  embed: typeof embedKnowledgeBatch = embedKnowledgeBatch,
): Promise<{ body: string; items: ChunkItem[] }> => {
  const pieces = splitSegments(
    segments.map((s) => {
      return { ...s, text: sanitizeForText(s.text).trim() }
    }),
  ).filter((p) => p.body.trim() !== "")
  if (pieces.length === 0) {
    throw indexError(`${EMPTY_BODY_PREFIX} dialogue has no text`)
  }
  const embedded = await embed(pieces.map((p) => p.body))
  if (embedded.isErr()) {
    throw indexError(`embed: ${embedded.error.message}`)
  }
  const vectors = embedded.value
  if (vectors.length !== pieces.length) {
    throw indexError(`embedder returned ${vectors.length} vectors for ${pieces.length} pieces`)
  }
  return {
    body: pieces.map((p) => p.body).join("\n"),
    items: pieces.map((p, k) => {
      return {
        ordinal: k,
        body: p.body,
        tokenCount: approxTokens(p.body),
        embedding: vectors[k] ?? null,
        embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
        segmentFrom: p.segmentFrom,
        segmentTo: p.segmentTo,
        startMs: p.startMs,
        endMs: p.endMs,
        speaker: p.speaker,
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
