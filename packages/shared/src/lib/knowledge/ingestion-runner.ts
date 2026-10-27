/**
 * Background ingestion runner (contract 1.11.0). Claims jobs with a lease and
 * carries each through its stages:
 *
 *   index  — sanitize, chunk, embed (no transaction), then persist the passages
 *            and mark the material embedded (short transaction)  → text_ready
 *   cards  — extract cards (no transaction), then persist them
 *   graph  — extract entities/relations (no transaction), then persist them
 *   done   — status ready; the text is dropped from the job
 *
 * Model calls never run inside a transaction. Every database step runs inside
 * `withTenant(job.tenantId)`, so the job's tenant — fixed when it was created —
 * scopes every read and write. The lease is extended by a heartbeat while a
 * stage runs; a crashed worker's lease expires and another worker resumes from
 * the job's stage (each stage is idempotent: passages and cards are replaced).
 * A retryable failure waits with exponential backoff and jitter; after
 * `max_attempts` claims the job fails with a safe error code and message.
 */

import type { Database } from "@agenticmind/shared/database/client"
import type {
  IngestionCoverage,
  IngestionStage,
} from "@agenticmind/shared/database/query/knowledge/ingestion-jobs"
import type { IngestionJobSelect } from "@agenticmind/shared/database/schema"
import type { extractCards } from "@agenticmind/shared/lib/knowledge/cards-extractor"
import type { GraphStore } from "@agenticmind/shared/lib/knowledge/graph-store"
import type { IngestionStatus } from "@agenticmind/shared/lib/knowledge/source-contract"

import { withTenant } from "@agenticmind/shared/database/client"
import {
  advanceIngestionJob,
  claimIngestionJobs,
  failIngestionJob,
  heartbeatIngestionJob,
  scheduleIngestionRetry,
} from "@agenticmind/shared/database/query/knowledge/ingestion-jobs"
import {
  getMaterial,
  updateMaterialStatus,
} from "@agenticmind/shared/database/query/knowledge/materials"
import { CARDS_MAX_BODY_CHARS } from "@agenticmind/shared/lib/knowledge/card"
import { extractGraph } from "@agenticmind/shared/lib/knowledge/graphrag-extractor"
import { createPostgresGraphStore } from "@agenticmind/shared/lib/knowledge/graphrag-postgres"
import {
  computeCardItems,
  EMPTY_BODY_PREFIX,
  persistCardItems,
  persistChunkItems,
  prepareChunkItems,
} from "@agenticmind/shared/lib/knowledge/indexer"
import { embedKnowledgeBatch } from "@agenticmind/shared/lib/knowledge/llm"
import { sanitizeForText } from "@agenticmind/shared/lib/knowledge/sanitize"

/** What a job's payload carries (set when the job is created). */
export type IngestionPayload = {
  title: string
  text: string
  cardsEnabled?: boolean
  acceptanceEvaluator?: boolean
  graphragEnabled?: boolean
}

export type IngestionRunnerDeps = {
  db: Database
  /** Unique per worker process; the lease owner. */
  workerId: string
  leaseSeconds?: number
  heartbeatMs?: number
  /** Overrides for tests; default to the real embedder / extractors / graph store. */
  embed?: typeof embedKnowledgeBatch
  extractCards?: typeof extractCards
  extractGraph?: typeof extractGraph
  graphStoreFor?: (tx: Parameters<typeof createPostgresGraphStore>[0]) => GraphStore
  /** Jitter source in [0, 1); Math.random by default. */
  random?: () => number
}

export const DEFAULT_LEASE_SECONDS = 120
export const DEFAULT_HEARTBEAT_MS = 30_000
const RETRY_BASE_SECONDS = 30
const RETRY_CAP_SECONDS = 3600

/** Safe, client-facing descriptions per error code — never a stack trace. */
export const INGESTION_ERROR_MESSAGES: Record<string, string> = {
  empty_content: "The text is empty after cleaning; there is nothing to index.",
  material_missing: "The material this job indexes no longer exists.",
  embedding_failed: "Embedding the text failed.",
  cards_failed: "Extracting knowledge cards failed; the passages are searchable.",
  graph_failed: "Extracting the knowledge graph failed; the passages are searchable.",
  attempts_exhausted: "The job was interrupted too many times.",
  internal: "Indexing failed on an unexpected error.",
}

class StageError extends Error {
  override readonly name = "StageError"
  readonly code: string
  readonly retryable: boolean
  constructor(code: string, retryable: boolean, detail: string) {
    super(detail)
    this.code = code
    this.retryable = retryable
  }
}

/** Exponential backoff with ±20% jitter, capped at an hour. `attempt` ≥ 1. */
export const retryDelaySeconds = (attempt: number, random: () => number = Math.random): number => {
  const base = Math.min(RETRY_CAP_SECONDS, RETRY_BASE_SECONDS * 2 ** Math.max(0, attempt - 1))
  return Math.max(1, Math.round(base * (0.8 + 0.4 * random())))
}

const nextStage = (stage: IngestionStage, payload: IngestionPayload): IngestionStage => {
  if (stage === "index" && payload.cardsEnabled === true) {
    return "cards"
  }
  if ((stage === "index" || stage === "cards") && payload.graphragEnabled === true) {
    return "graph"
  }
  return "done"
}

const statusAfter = (stage: IngestionStage): IngestionStatus =>
  stage === "done" ? "ready" : "text_ready"

const readPayload = (job: IngestionJobSelect): IngestionPayload => {
  const p = (job.payload ?? {}) as Partial<IngestionPayload>
  return {
    title: typeof p.title === "string" ? p.title : "",
    text: typeof p.text === "string" ? p.text : "",
    cardsEnabled: p.cardsEnabled === true,
    acceptanceEvaluator: p.acceptanceEvaluator === true,
    graphragEnabled: p.graphragEnabled === true,
  }
}

type LoadedMaterial = { id: string; title: string; ftsConfig: string }

const loadMaterial = async (deps: IngestionRunnerDeps, job: IngestionJobSelect) => {
  if (job.materialId === null) {
    throw new StageError("material_missing", false, "job has no material")
  }
  const materialId = job.materialId
  const found = await withTenant(deps.db, job.tenantId, async (tx) =>
    getMaterial({ tx, id: materialId }),
  )
  if (found.isErr()) {
    throw new StageError("internal", true, found.error.message)
  }
  if (found.value === null) {
    throw new StageError("material_missing", false, `material ${materialId} not found`)
  }
  const m = found.value
  return { id: m.id, title: m.title, ftsConfig: m.ftsConfig } satisfies LoadedMaterial
}

/** Runs one stage. Returns coverage when the stage measures it. */
const runStage = async (
  deps: IngestionRunnerDeps,
  job: IngestionJobSelect,
  stage: IngestionStage,
  payload: IngestionPayload,
  material: LoadedMaterial,
): Promise<IngestionCoverage | undefined> => {
  if (stage === "index") {
    let prepared: Awaited<ReturnType<typeof prepareChunkItems>>
    try {
      prepared = await prepareChunkItems(payload.text, deps.embed ?? embedKnowledgeBatch)
    } catch (error) {
      const message = String((error as { message?: unknown }).message ?? error)
      if (message.startsWith(EMPTY_BODY_PREFIX)) {
        await withTenant(deps.db, job.tenantId, async (tx) =>
          updateMaterialStatus({
            tx,
            id: material.id,
            status: "failed",
            errorMessage: message.slice(EMPTY_BODY_PREFIX.length).trim(),
          }),
        )
        throw new StageError("empty_content", false, message)
      }
      throw new StageError("embedding_failed", true, message)
    }
    await withTenant(deps.db, job.tenantId, async (tx) =>
      persistChunkItems(tx, material, prepared.items),
    )
    return undefined
  }

  if (stage === "cards") {
    const body = sanitizeForText(payload.text).trim()
    const totalChars = Array.from(body).length
    const computed = await computeCardItems({
      material,
      body,
      cardsEnabled: payload.cardsEnabled,
      acceptanceEvaluator: payload.acceptanceEvaluator,
      extract: deps.extractCards,
      embed: deps.embed,
    })
    if (!computed.ok) {
      throw new StageError("cards_failed", true, computed.reason)
    }
    await withTenant(deps.db, job.tenantId, async (tx) =>
      persistCardItems(tx, material, computed.items),
    )
    // The extractor reads the first CARDS_MAX_BODY_CHARS characters; coverage
    // says so instead of implying the whole text was read.
    return {
      processedChars: Math.min(totalChars, CARDS_MAX_BODY_CHARS),
      totalChars,
      windows: 1,
      failedWindows: 0,
    }
  }

  if (stage === "graph") {
    const extract = deps.extractGraph ?? extractGraph
    const g = await extract({
      materialId: material.id,
      materialTitle: material.title,
      body: payload.text,
    })
    if (g.isErr()) {
      throw new StageError("graph_failed", true, g.error.message)
    }
    const storeFor = deps.graphStoreFor ?? createPostgresGraphStore
    await withTenant(deps.db, job.tenantId, async (tx) => {
      const up = await storeFor(tx).upsertExtraction(g.value)
      if (up.isErr()) {
        throw new StageError("graph_failed", true, up.error.message)
      }
    })
    return undefined
  }
  return undefined
}

const settleFailure = async (
  deps: IngestionRunnerDeps,
  job: IngestionJobSelect,
  error: unknown,
): Promise<void> => {
  const stageError =
    error instanceof StageError
      ? error
      : new StageError("internal", true, error instanceof Error ? error.message : String(error))
  console.warn(`[INGEST] job ${job.id} ${stageError.code}: ${stageError.message}`)
  const message = INGESTION_ERROR_MESSAGES[stageError.code] ?? INGESTION_ERROR_MESSAGES.internal
  if (stageError.retryable && job.attempts < job.maxAttempts) {
    await scheduleIngestionRetry({
      tx: deps.db,
      id: job.id,
      owner: deps.workerId,
      errorCode: stageError.code,
      errorMessage: `${message ?? ""} Retrying.`.trim(),
      delaySeconds: retryDelaySeconds(job.attempts, deps.random),
    })
    return
  }
  await failIngestionJob({
    tx: deps.db,
    id: job.id,
    owner: deps.workerId,
    errorCode: stageError.code,
    errorMessage: message ?? "",
  })
}

/** Runs a claimed job from its checkpoint to `done` or to a failure. */
export const runClaimedJob = async (
  deps: IngestionRunnerDeps,
  job: IngestionJobSelect,
): Promise<void> => {
  const leaseSeconds = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  if (job.attempts > job.maxAttempts) {
    await failIngestionJob({
      tx: deps.db,
      id: job.id,
      owner: deps.workerId,
      errorCode: "attempts_exhausted",
      errorMessage: INGESTION_ERROR_MESSAGES.attempts_exhausted ?? "",
    })
    return
  }
  let leaseLost = false
  const keepLease = async (): Promise<void> => {
    const held = await heartbeatIngestionJob({
      tx: deps.db,
      id: job.id,
      owner: deps.workerId,
      leaseSeconds,
    })
    // A failed heartbeat is not a lost lease; a false answer is.
    if (held.isOk() && !held.value) {
      leaseLost = true
    }
  }
  const beat = setInterval(() => {
    void keepLease()
  }, deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS)
  try {
    const payload = readPayload(job)
    const material = await loadMaterial(deps, job)
    let stage = job.stage as IngestionStage
    while (stage !== "done") {
      const coverage = await runStage(deps, job, stage, payload, material)
      if (leaseLost) {
        return
      }
      const next = nextStage(stage, payload)
      const advanced = await advanceIngestionJob({
        tx: deps.db,
        id: job.id,
        owner: deps.workerId,
        stage: next,
        status: statusAfter(next),
        coverage,
      })
      if (advanced.isErr() || advanced.value === null) {
        return
      }
      stage = next
    }
  } catch (error) {
    await settleFailure(deps, job, error)
  } finally {
    clearInterval(beat)
  }
}

/** Claims up to `limit` jobs and runs them concurrently. Returns how many ran. */
export const runIngestionTick = async (deps: IngestionRunnerDeps, limit = 2): Promise<number> => {
  const claimed = await claimIngestionJobs({
    tx: deps.db,
    owner: deps.workerId,
    limit,
    leaseSeconds: deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
  })
  if (claimed.isErr()) {
    console.error(`[INGEST] claim failed: ${claimed.error.message}`)
    return 0
  }
  await Promise.all(claimed.value.map(async (job) => runClaimedJob(deps, job)))
  return claimed.value.length
}
