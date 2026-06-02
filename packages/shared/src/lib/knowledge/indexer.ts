/**
 * Indexing pipeline orchestration. For one material:
 * sanitize → status=chunking → chunk → status=embedding → embed →
 * upsertChunks → status=embedded, then best-effort card extraction
 * (deterministic tabular path or LLM) that never aborts the vector path.
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
import { extractCards } from "@agenticmind/shared/lib/knowledge/cards-extractor"
import { extractFromTables } from "@agenticmind/shared/lib/knowledge/cards-tabular"
import { approxTokens, splitText } from "@agenticmind/shared/lib/knowledge/chunker"
import {
  embedKnowledgeBatch,
  KNOWLEDGE_EMBEDDING_MODEL,
} from "@agenticmind/shared/lib/knowledge/llm"
import { sanitizeForText } from "@agenticmind/shared/lib/knowledge/sanitize"
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
}

const indexError = (message: string): IndexError => {
  return { type: "index_error", message }
}

const markFailed = async (tx: Transaction, id: string, reason: string): Promise<void> => {
  await updateMaterialStatus({ tx, id, status: "failed", errorMessage: reason })
}

/**
 * Best-effort card extraction + embed + upsert. Never throws — failures are
 * logged and the material stays vector-searchable via chunks alone.
 */
const runCardExtraction = async (props: IndexMaterialProps, body: string): Promise<void> => {
  const { tx, material, extras, cardsEnabled } = props
  try {
    let items: CardInput[] = []
    if (extras?.schema !== undefined && extras.tables !== undefined && extras.tables.length > 0) {
      items = extractFromTables(extras.tables, extras.schema)
    } else if (cardsEnabled === true) {
      const extracted = await extractCards({ materialTitle: material.title, body })
      if (extracted.isErr()) {
        console.warn(`index: cards extract failed for ${material.id}: ${extracted.error.message}`)
        return
      }
      items = extracted.value
    } else {
      return
    }
    if (items.length === 0) {
      return
    }

    const embedded = await embedKnowledgeBatch(items.map((c) => c.body))
    const vectors = embedded.isOk() ? embedded.value : null
    if (vectors === null) {
      console.warn(`index: cards embed failed for ${material.id} (persisting BM25-only)`)
    }
    const withEmbeddings = items.map((c, k) =>
      vectors !== null && vectors[k] !== undefined
        ? { ...c, embedding: vectors[k], embeddingModel: KNOWLEDGE_EMBEDDING_MODEL }
        : c,
    )
    const upserted = await upsertCards({
      tx,
      materialId: material.id,
      items: withEmbeddings,
      ftsConfig: material.ftsConfig,
    })
    if (upserted.isErr()) {
      console.warn(`index: cards upsert failed for ${material.id}: ${upserted.error.message}`)
    }
  } catch (error) {
    console.warn(`index: card extraction crashed for ${material.id}: ${String(error)}`)
  }
}

const runIndex = async (props: IndexMaterialProps): Promise<{ chunkCount: number }> => {
  const { tx, material } = props
  const rawLen = props.body.length
  const body = sanitizeForText(props.body).trim()
  if (body === "") {
    const reason =
      rawLen > 0 ? "extracted text was empty (likely a scan-only PDF — needs OCR)" : "empty body"
    await markFailed(tx, material.id, reason)
    throw indexError(`${reason} for material ${material.id}`)
  }

  const toChunking = await updateMaterialStatus({ tx, id: material.id, status: "chunking" })
  if (toChunking.isErr()) {
    throw indexError(`status→chunking: ${toChunking.error.message}`)
  }

  const pieces = splitText(body)
  if (pieces.length === 0) {
    await markFailed(tx, material.id, "chunker produced 0 chunks")
    throw indexError(`chunker produced 0 chunks for material ${material.id}`)
  }

  const toEmbedding = await updateMaterialStatus({ tx, id: material.id, status: "embedding" })
  if (toEmbedding.isErr()) {
    throw indexError(`status→embedding: ${toEmbedding.error.message}`)
  }

  const embedded = await embedKnowledgeBatch(pieces)
  if (embedded.isErr()) {
    await markFailed(tx, material.id, `embed: ${embedded.error.message}`)
    throw indexError(`embed: ${embedded.error.message}`)
  }
  const vectors = embedded.value
  if (vectors.length !== pieces.length) {
    const msg = `embedder returned ${vectors.length} vectors for ${pieces.length} pieces`
    await markFailed(tx, material.id, msg)
    throw indexError(msg)
  }

  const items = pieces.map((body_, k) => {
    return {
      ordinal: k,
      body: body_,
      tokenCount: approxTokens(body_),
      embedding: vectors[k] ?? null,
      embeddingModel: KNOWLEDGE_EMBEDDING_MODEL,
    }
  })
  const persisted = await upsertChunks({
    tx,
    materialId: material.id,
    items,
    ftsConfig: material.ftsConfig,
  })
  if (persisted.isErr()) {
    await markFailed(tx, material.id, `persist: ${persisted.error.message}`)
    throw indexError(`persist: ${persisted.error.message}`)
  }

  await updateMaterialStatus({ tx, id: material.id, status: "embedded" })

  // Best-effort Tier-1 cards. Skip graphrag for tabular materials (handled
  // Separately). Graph extraction is wired in a later brick.
  await runCardExtraction(props, body)

  return { chunkCount: items.length }
}

/** Runs the full indexing pipeline for one material. */
export const indexMaterial = (
  props: IndexMaterialProps,
): ResultAsync<{ chunkCount: number }, IndexError> =>
  ResultAsync.fromPromise(runIndex(props), (e) =>
    e !== null && typeof e === "object" && "type" in e && (e as IndexError).type === "index_error"
      ? (e as IndexError)
      : indexError(e instanceof Error ? e.message : String(e)),
  )
