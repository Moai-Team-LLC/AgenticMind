/**
 * High-level ingestion orchestrator — the single entry to populate the
 * knowledge base. Wires the engine end-to-end: upload (blob + material row) →
 * index (sanitize → chunk → embed → cards) → optional graph extraction
 * (entities/relations → GraphStore). Used by the `kl_ingest` MCP tool and the
 * `scripts/ingest.ts` CLI so the base can actually be filled. The MCP tool runs
 * it under a time budget or asynchronously; what does not fit becomes a
 * background job (ingestion-runner.ts).
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { IngestionStage } from "@agenticmind/shared/database/query/knowledge/ingestion-jobs"
import type { IngestionJobSelect } from "@agenticmind/shared/database/schema"
import type { KnowledgeBlobStore } from "@agenticmind/shared/lib/knowledge/blobstore"
import type { extractCards } from "@agenticmind/shared/lib/knowledge/cards-extractor"
import type { GraphStore } from "@agenticmind/shared/lib/knowledge/graph-store"
import type { IngestionPayload } from "@agenticmind/shared/lib/knowledge/ingestion-runner"
import type { embedKnowledgeBatch } from "@agenticmind/shared/lib/knowledge/llm"
import type { IngestionStatus } from "@agenticmind/shared/lib/knowledge/source-contract"
import type { Lifecycle } from "@agenticmind/shared/lib/knowledge/source-trust"

import {
  findIngestionJobByDedupeKey,
  insertIngestionJob,
  requeueFailedIngestionJob,
} from "@agenticmind/shared/database/query/knowledge/ingestion-jobs"
import {
  updateMaterialLifecycle,
  updateMaterialStatus,
} from "@agenticmind/shared/database/query/knowledge/materials"
import { isSupportedLanguage } from "@agenticmind/shared/database/schema/knowledge/_config"
import { extractGraph } from "@agenticmind/shared/lib/knowledge/graphrag-extractor"
import {
  computeCardItems,
  EMPTY_BODY_PREFIX,
  indexMaterial,
  persistCardItems,
  persistChunkItems,
  prepareChunkItems,
} from "@agenticmind/shared/lib/knowledge/indexer"
import { removeMaterial, uploadManual } from "@agenticmind/shared/lib/knowledge/ingestion"
import { ResultAsync } from "neverthrow"
import { createHash } from "node:crypto"

export type IngestError = { readonly type: "ingest_error"; readonly message: string }
const ingestError = (message: string): IngestError => {
  return { type: "ingest_error", message }
}

export type IngestResult = {
  materialId: string
  title: string
  chunkCount: number
  entities: number
  relations: number
  /** `ready`, or the background job's status when work continues there. */
  status: IngestionStatus
  /** The background job finishing this ingest, or null when nothing is left. */
  jobId: string | null
}

/**
 * Time a synchronous MCP ingest may spend before handing the rest to a
 * background job. Well under the MCP handler's request cap (60 s, see
 * apps/server/src/mcp.ts), which otherwise ends the request with an empty
 * response while card extraction (up to 90 s) is still running.
 */
export const SYNC_INGEST_BUDGET_MS = 40_000

const safeFilename = (title: string): string => {
  const base = title
    .trim()
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, "_")
    .slice(0, 80)
  return `${base === "" ? "material" : base}.txt`
}

export type IngestTextProps = {
  tx: Transaction
  blobStore: KnowledgeBlobStore
  graph?: GraphStore
  title: string
  text: string
  contentType?: string
  cardsEnabled?: boolean
  /** Run the acceptance evaluator on extracted cards before storage. Default off. */
  acceptanceEvaluator?: boolean
  graphragEnabled?: boolean
  language?: string
  /** Content lifecycle to stamp on the material (default active). */
  lifecycle?: Lifecycle
  /** Source trust tier to stamp on the material (default 0). */
  trustTier?: number
  /** The principal ingesting (JWT subject); owns the job, recorded on the material. */
  createdBy?: string | null
  /** Store the material and return at once; a background job indexes it. */
  async?: boolean
  /** Spend at most this long, then let a background job finish (see
   * SYNC_INGEST_BUDGET_MS). Unset = run everything inline, as before. */
  budgetMs?: number
  /** Overrides for tests. */
  embed?: typeof embedKnowledgeBatch
  extractCards?: typeof extractCards
}

const createMaterialRow = async (props: IngestTextProps, ftsConfig: string) => {
  const title = props.title.trim()
  const bytes = new TextEncoder().encode(props.text)
  const mat = await uploadManual({
    tx: props.tx,
    blobStore: props.blobStore,
    upload: {
      filename: safeFilename(title),
      title,
      contentType: props.contentType ?? "text/plain",
      sizeBytes: bytes.length,
      body: bytes,
      ftsConfig,
      uploaderId: props.createdBy ?? null,
    },
  })
  if (mat.isErr()) {
    throw ingestError(`upload: ${mat.error.message}`)
  }
  const material = mat.value

  // Stamp trust metadata when supplied (default: active / tier 0 from the schema).
  if (props.lifecycle !== undefined || props.trustTier !== undefined) {
    const stamped = await updateMaterialLifecycle({
      tx: props.tx,
      id: material.id,
      ...(props.lifecycle !== undefined ? { lifecycle: props.lifecycle } : {}),
      ...(props.trustTier !== undefined ? { trustTier: props.trustTier } : {}),
    })
    if (stamped.isErr()) {
      throw ingestError(`trust: ${stamped.error.message}`)
    }
  }
  return material
}

/** The original path: everything inline in the caller's transaction. */
const ingestInline = async (props: IngestTextProps, ftsConfig: string): Promise<IngestResult> => {
  const material = await createMaterialRow(props, ftsConfig)
  const indexed = await indexMaterial({
    tx: props.tx,
    material: { id: material.id, title: material.title, ftsConfig: material.ftsConfig },
    body: props.text,
    cardsEnabled: props.cardsEnabled,
    acceptanceEvaluator: props.acceptanceEvaluator,
  })
  if (indexed.isErr()) {
    throw ingestError(`index: ${indexed.error.message}`)
  }

  let entities = 0
  let relations = 0
  if (props.graphragEnabled === true && props.graph !== undefined) {
    const g = await extractGraph({
      materialId: material.id,
      materialTitle: material.title,
      body: props.text,
    })
    if (g.isOk()) {
      const up = await props.graph.upsertExtraction(g.value)
      if (up.isOk()) {
        entities = g.value.entities.length
        relations = g.value.relations.length
      }
    }
  }

  return {
    materialId: material.id,
    title: material.title,
    chunkCount: indexed.value.chunkCount,
    entities,
    relations,
    status: "ready",
    jobId: null,
  }
}

const payloadOf = (props: IngestTextProps): IngestionPayload => {
  return {
    title: props.title.trim(),
    text: props.text,
    cardsEnabled: props.cardsEnabled === true,
    acceptanceEvaluator: props.acceptanceEvaluator === true,
    graphragEnabled: props.graphragEnabled === true && props.graph !== undefined,
  }
}

const enqueue = async (
  props: IngestTextProps,
  materialId: string,
  stage: IngestionStage,
  status: IngestionStatus,
  dedupeKey?: string,
) => {
  const job = await insertIngestionJob({
    tx: props.tx,
    job: {
      materialId,
      createdBy: props.createdBy ?? null,
      stage,
      status,
      payload: payloadOf(props),
      dedupeKey: dedupeKey ?? null,
    },
  })
  if (job.isErr()) {
    throw ingestError(`enqueue: ${job.error.message}`)
  }
  return job.value
}

type Raced<T> = { timedOut: true } | { timedOut: false; value: T }

type Settled<T> = { timedOut: false; value: T } | { timedOut: false; error: unknown }

/** Waits for `work` until `deadlineAt` (epoch ms). A late result is discarded. */
const raceDeadline = async <T>(
  work: Promise<T>,
  deadlineAt: number,
  onTimeout?: () => void,
): Promise<Raced<T>> => {
  // Never rejects, so an abandoned stage that fails later is not an unhandled rejection.
  const settled = (async (): Promise<Settled<T>> => {
    try {
      return { timedOut: false, value: await work }
    } catch (error) {
      return { timedOut: false, error }
    }
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(
      () => {
        resolve({ timedOut: true })
      },
      Math.max(0, deadlineAt - Date.now()),
    )
  })
  try {
    const result = await Promise.race([settled, expired])
    if (result.timedOut) {
      onTimeout?.()
      return result
    }
    if ("error" in result) {
      throw result.error
    }
    return result
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The MCP path: the same stages as ingestInline, but each model step races the
 * budget. Nothing is written for a step that ran out of time; a background job
 * takes over from that step, and the response says so (`status`, `jobId`)
 * instead of the request being cut off with an empty answer. A card or graph
 * step that fails is also handed to the job, which retries it.
 */
const ingestWithBudget = async (
  props: IngestTextProps,
  ftsConfig: string,
  budgetMs: number,
): Promise<IngestResult> => {
  const deadlineAt = Date.now() + budgetMs
  const material = await createMaterialRow(props, ftsConfig)
  const base = { materialId: material.id, title: material.title, entities: 0, relations: 0 }
  const handOff = async (
    stage: IngestionStage,
    status: IngestionStatus,
    chunkCount: number,
  ): Promise<IngestResult> => {
    const job = await enqueue(props, material.id, stage, status)
    return { ...base, chunkCount, status, jobId: job?.id ?? null }
  }

  let prepared: Raced<Awaited<ReturnType<typeof prepareChunkItems>>>
  try {
    prepared = await raceDeadline(prepareChunkItems(props.text, props.embed), deadlineAt)
  } catch (error) {
    const message = String((error as { message?: unknown }).message ?? error)
    await updateMaterialStatus({
      tx: props.tx,
      id: material.id,
      status: "failed",
      errorMessage: message.replace(EMPTY_BODY_PREFIX, "").trim(),
    })
    throw ingestError(`index: ${message}`)
  }
  if (prepared.timedOut) {
    return handOff("index", "queued", 0)
  }
  await persistChunkItems(props.tx, material, prepared.value.items)
  const chunkCount = prepared.value.items.length

  if (props.cardsEnabled === true) {
    if (Date.now() >= deadlineAt) {
      return handOff("cards", "text_ready", chunkCount)
    }
    const abort = new AbortController()
    const computed = await raceDeadline(
      computeCardItems({
        material,
        body: prepared.value.body,
        cardsEnabled: true,
        acceptanceEvaluator: props.acceptanceEvaluator,
        extract: props.extractCards,
        embed: props.embed,
        abortSignal: abort.signal,
      }),
      deadlineAt,
      () => {
        abort.abort()
      },
    )
    if (computed.timedOut || !computed.value.ok) {
      return handOff("cards", "text_ready", chunkCount)
    }
    await persistCardItems(props.tx, material, computed.value.items)
  }

  let entities = 0
  let relations = 0
  if (props.graphragEnabled === true && props.graph !== undefined) {
    if (Date.now() >= deadlineAt) {
      return handOff("graph", "text_ready", chunkCount)
    }
    const g = await raceDeadline(
      Promise.resolve(
        extractGraph({ materialId: material.id, materialTitle: material.title, body: props.text }),
      ),
      deadlineAt,
    )
    if (g.timedOut || g.value.isErr()) {
      return handOff("graph", "text_ready", chunkCount)
    }
    const up = await props.graph.upsertExtraction(g.value.value)
    if (up.isErr()) {
      return handOff("graph", "text_ready", chunkCount)
    }
    entities = g.value.value.entities.length
    relations = g.value.value.relations.length
  }

  return { ...base, chunkCount, entities, relations, status: "ready", jobId: null }
}

/** Same call, same content: the job is found again instead of created again. */
const dedupeKeyOf = (props: IngestTextProps, ftsConfig: string): string =>
  createHash("sha256")
    .update(
      [
        "kl_ingest:v1",
        props.title.trim(),
        ftsConfig,
        props.lifecycle ?? "",
        String(props.trustTier ?? ""),
        props.text,
      ].join("\u0000"),
    )
    .digest("hex")

const fromJob = (job: IngestionJobSelect, title: string): IngestResult => {
  return {
    materialId: job.materialId ?? "",
    title,
    chunkCount: 0,
    entities: 0,
    relations: 0,
    status: job.status as IngestionStatus,
    jobId: job.id,
  }
}

/** Stores the material, queues its job and returns at once. Idempotent. */
const ingestAsync = async (props: IngestTextProps, ftsConfig: string): Promise<IngestResult> => {
  const dedupeKey = dedupeKeyOf(props, ftsConfig)
  const title = props.title.trim()
  const findExisting = async (): Promise<IngestResult | null> => {
    const found = await findIngestionJobByDedupeKey({ tx: props.tx, dedupeKey })
    if (found.isErr()) {
      throw ingestError(`dedupe: ${found.error.message}`)
    }
    if (found.value === null) {
      return null
    }
    if (found.value.status === "failed") {
      // A repeated delivery of a failed ingest is a request to try again.
      const requeued = await requeueFailedIngestionJob({ tx: props.tx, id: found.value.id })
      if (requeued.isOk() && requeued.value !== null) {
        return fromJob(requeued.value, title)
      }
    }
    return fromJob(found.value, title)
  }

  const existing = await findExisting()
  if (existing !== null) {
    return existing
  }
  const material = await createMaterialRow(props, ftsConfig)
  const job = await enqueue(props, material.id, "index", "queued", dedupeKey)
  if (job === null) {
    // A concurrent identical call won the key: drop this copy, answer with theirs.
    await removeMaterial({ tx: props.tx, blobStore: props.blobStore, id: material.id })
    const winner = await findExisting()
    if (winner === null) {
      throw ingestError("dedupe: the job holding this key disappeared")
    }
    return winner
  }
  return fromJob(job, material.title)
}

/**
 * Ingests a piece of text as a material. Without `async` or `budgetMs` each
 * call creates a new material and indexes it inline (idempotency is the
 * caller's concern). Graph extraction only runs when `graphragEnabled` and a
 * `graph` store are provided.
 */
export const ingestText = (props: IngestTextProps): ResultAsync<IngestResult, IngestError> => {
  const ftsConfig =
    props.language !== undefined && isSupportedLanguage(props.language) ? props.language : "simple"
  const run = async (): Promise<IngestResult> => {
    if (props.async === true) {
      return ingestAsync(props, ftsConfig)
    }
    if (props.budgetMs !== undefined) {
      return ingestWithBudget(props, ftsConfig, props.budgetMs)
    }
    return ingestInline(props, ftsConfig)
  }
  return ResultAsync.fromPromise(run(), (e) =>
    e !== null && typeof e === "object" && "type" in e && (e as IngestError).type === "ingest_error"
      ? (e as IngestError)
      : ingestError(
          e !== null && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : String(e),
        ),
  )
}
