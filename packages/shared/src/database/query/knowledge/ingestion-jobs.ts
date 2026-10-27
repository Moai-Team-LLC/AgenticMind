/**
 * Ingestion jobs repository (contract 1.11.0). Enqueue with an idempotency key,
 * claim with a lease (FOR UPDATE SKIP LOCKED, so replicas never share a job),
 * heartbeat, advance a stage, schedule a retry, fail. Every write after the
 * claim is conditional on `lease_owner`, so a worker that lost its lease
 * cannot overwrite the worker that took over. `{ tx }` props, neverthrow,
 * mapDatabaseError — the repo's query convention.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { IngestionJobSelect } from "@agenticmind/shared/database/schema"
import type { IngestionStatus } from "@agenticmind/shared/lib/knowledge/source-contract"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { ingestionJobs } from "@agenticmind/shared/database/schema"
import { currentTenantId } from "@agenticmind/shared/database/schema/knowledge/_tenant"
import { and, desc, eq, isNotNull, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type IngestionStage = "index" | "cards" | "graph" | "done"

export type IngestionCoverage = {
  processedChars: number
  totalChars: number
  windows: number
  failedWindows: number
}

export type NewIngestionJob = {
  /** `index_material` (default) or `purge_source`. */
  kind?: "index_material" | "purge_source"
  materialId: string | null
  /** Set when the job indexes a source revision. */
  sourceId?: string | null
  revisionId?: string | null
  createdBy: string | null
  stage: IngestionStage
  status: IngestionStatus
  payload: Record<string, unknown>
  dedupeKey?: string | null
}

/** Inserts a job. With a dedupe key already taken, inserts nothing and returns null. */
export const insertIngestionJob = (props: { tx: Transaction; job: NewIngestionJob }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .insert(ingestionJobs)
        .values({
          kind: props.job.kind ?? "index_material",
          materialId: props.job.materialId,
          sourceId: props.job.sourceId ?? null,
          revisionId: props.job.revisionId ?? null,
          createdBy: props.job.createdBy,
          stage: props.job.stage,
          status: props.job.status,
          payload: props.job.payload,
          dedupeKey: props.job.dedupeKey ?? null,
        })
        .onConflictDoNothing({
          target: [ingestionJobs.tenantId, ingestionJobs.dedupeKey],
          where: isNotNull(ingestionJobs.dedupeKey),
        })
        .returning()
      return row ?? null
    })(),
    mapDatabaseError,
  )

/** The job holding `dedupeKey` in the current tenant, or null. */
export const findIngestionJobByDedupeKey = (props: { tx: Transaction; dedupeKey: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(ingestionJobs)
        .where(
          and(
            eq(ingestionJobs.tenantId, currentTenantId),
            eq(ingestionJobs.dedupeKey, props.dedupeKey),
          ),
        )
        .limit(1)
      return row ?? null
    })(),
    mapDatabaseError,
  )

/** The (newest) job indexing a revision, or null. */
export const findIngestionJobByRevision = (props: { tx: Transaction; revisionId: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.revisionId, props.revisionId))
        .orderBy(desc(ingestionJobs.createdAt))
        .limit(1)
      return row ?? null
    })(),
    mapDatabaseError,
  )

export const getIngestionJob = (props: { tx: Transaction; id: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .select()
        .from(ingestionJobs)
        .where(eq(ingestionJobs.id, props.id))
        .limit(1)
      return row ?? null
    })(),
    mapDatabaseError,
  )

/** Puts a failed job back in the queue from its checkpoint (a re-delivery retries it). */
export const requeueFailedIngestionJob = (props: { tx: Transaction; id: string }) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .update(ingestionJobs)
        .set({
          status: sql`case when ${ingestionJobs.stage} = 'index' then 'queued' else 'text_ready' end`,
          attempts: 0,
          errorCode: null,
          errorMessage: null,
          nextAttemptAt: sql`now()`,
          finishedAt: null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(ingestionJobs.id, props.id), eq(ingestionJobs.status, "failed")))
        .returning()
      return row ?? null
    })(),
    mapDatabaseError,
  )

/**
 * Claims up to `limit` runnable jobs for `owner`: due, unleased or with an
 * expired lease (its worker died), not finished. Each claim counts as an
 * attempt. A job at its first stage becomes `indexing`; a later stage keeps
 * `text_ready`. Runs on the worker's connection, across tenants.
 */
export const claimIngestionJobs = (props: {
  tx: Transaction
  owner: string
  limit: number
  leaseSeconds: number
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const res = await props.tx.execute(sql`
        update ingestion_jobs set
          lease_owner = ${props.owner},
          lease_expires_at = now() + make_interval(secs => ${props.leaseSeconds}::int),
          heartbeat_at = now(),
          attempts = attempts + 1,
          status = case when stage = 'index' then 'indexing' else 'text_ready' end,
          updated_at = now()
        where id in (
          select id from ingestion_jobs
          where status in ('queued', 'retry_wait', 'indexing', 'text_ready')
            and stage <> 'done'
            and next_attempt_at <= now()
            and (lease_expires_at is null or lease_expires_at < now())
          order by next_attempt_at
          limit ${props.limit}::int
          for update skip locked
        )
        returning id
      `)
      const ids = (res.rows as { id: string }[]).map((r) => r.id)
      if (ids.length === 0) {
        return [] as IngestionJobSelect[]
      }
      const rows: IngestionJobSelect[] = []
      for (const id of ids) {
        const [row] = await props.tx
          .select()
          .from(ingestionJobs)
          .where(eq(ingestionJobs.id, id))
          .limit(1)
        if (row !== undefined) {
          rows.push(row)
        }
      }
      return rows
    })(),
    mapDatabaseError,
  )

/** Extends the lease. Returns false when `owner` no longer holds it. */
export const heartbeatIngestionJob = (props: {
  tx: Transaction
  id: string
  owner: string
  leaseSeconds: number
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const res = await props.tx.execute(sql`
        update ingestion_jobs set
          lease_expires_at = now() + make_interval(secs => ${props.leaseSeconds}::int),
          heartbeat_at = now()
        where id = ${props.id}::uuid and lease_owner = ${props.owner}
        returning id
      `)
      return res.rows.length > 0
    })(),
    mapDatabaseError,
  )

/**
 * Records a finished stage: the next stage and status, optional coverage.
 * Reaching `done` clears the lease, stamps finished_at and drops the text from
 * the payload (it is no longer needed). Null when `owner` lost the lease.
 */
export const advanceIngestionJob = (props: {
  tx: Transaction
  id: string
  owner: string
  stage: IngestionStage
  status: IngestionStatus
  coverage?: IngestionCoverage
  /** Recorded on the job (e.g. a partial result); cleared when omitted. */
  error?: { code: string; message: string }
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const done = props.stage === "done"
      const [row] = await props.tx
        .update(ingestionJobs)
        .set({
          stage: props.stage,
          status: props.status,
          ...(props.coverage !== undefined ? { coverage: props.coverage } : {}),
          errorCode: props.error?.code ?? null,
          errorMessage: props.error?.message ?? null,
          updatedAt: sql`now()`,
          ...(done
            ? {
                leaseOwner: null,
                leaseExpiresAt: null,
                finishedAt: sql`now()`,
                payload: sql`${ingestionJobs.payload} - 'text'`,
              }
            : {}),
        })
        .where(and(eq(ingestionJobs.id, props.id), eq(ingestionJobs.leaseOwner, props.owner)))
        .returning()
      return row ?? null
    })(),
    mapDatabaseError,
  )

/**
 * Releases the lease after a retryable failure; the next claim is due in
 * `delaySeconds`. Status: `retry_wait` before the passages exist, `text_ready`
 * after (they stay searchable) — `error_*` says what failed either way.
 */
export const scheduleIngestionRetry = (props: {
  tx: Transaction
  id: string
  owner: string
  errorCode: string
  errorMessage: string
  delaySeconds: number
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const res = await props.tx.execute(sql`
        update ingestion_jobs set
          status = case when stage = 'index' then 'retry_wait' else 'text_ready' end,
          lease_owner = null,
          lease_expires_at = null,
          next_attempt_at = now() + make_interval(secs => ${props.delaySeconds}::int),
          error_code = ${props.errorCode},
          error_message = ${props.errorMessage},
          updated_at = now()
        where id = ${props.id}::uuid and lease_owner = ${props.owner}
        returning id
      `)
      return res.rows.length > 0
    })(),
    mapDatabaseError,
  )

/** Terminal failure. The text stays in the payload so a re-delivery can retry it. */
export const failIngestionJob = (props: {
  tx: Transaction
  id: string
  owner: string
  errorCode: string
  errorMessage: string
}) =>
  ResultAsync.fromPromise(
    (async () => {
      const [row] = await props.tx
        .update(ingestionJobs)
        .set({
          status: "failed",
          leaseOwner: null,
          leaseExpiresAt: null,
          errorCode: props.errorCode,
          errorMessage: props.errorMessage,
          finishedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(ingestionJobs.id, props.id), eq(ingestionJobs.leaseOwner, props.owner)))
        .returning()
      return row ?? null
    })(),
    mapDatabaseError,
  )
