import { tenantColumn } from "@agenticmind/shared/database/schema/knowledge/_tenant"
import { materials } from "@agenticmind/shared/database/schema/knowledge/materials"
import {
  knowledgeSources,
  sourceRevisions,
} from "@agenticmind/shared/database/schema/knowledge/sources"
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

/**
 * Durable background indexing jobs (contract 1.11.0, `kl_get_ingestion_status`).
 * A job carries one material through its stages — `index` (passages +
 * embeddings), `cards`, `graph` — so no model call runs inside a request or a
 * long transaction. The worker claims a job with a lease (`lease_owner`,
 * `lease_expires_at`) and extends it by heartbeat; a crashed worker's lease
 * expires and another resumes from `stage`, the checkpoint. Every stage is
 * idempotent (passages and cards are replaced per material).
 *
 * `payload` holds what the stages need (title, text, flags) and is cleared once
 * the job is done; the row goes away with its material (ON DELETE CASCADE), so
 * no copy of the text outlives a forgotten material.
 *
 * Row-level security is enabled but not forced: the worker, which connects as
 * the table owner, claims jobs of every tenant, then runs each stage inside
 * `withTenant(job.tenant_id)`, where the material, passage and card tables
 * (forced) apply the job's tenant. The server's app role sees only its tenant.
 */
const ingestionJobs = pgTable(
  "ingestion_jobs",
  {
    ...tenantColumn,
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** What the job does; `index_material` carries one material through its stages. */
    kind: text("kind").notNull().default("index_material"),
    /** Client-visible status (INGESTION_STATUSES in source-contract.ts). */
    status: text("status").notNull().default("queued"),
    /** Next stage to run — the checkpoint a resumed job continues from. */
    stage: text("stage").notNull().default("index"),
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "cascade" }),
    /** Set when the job indexes a source revision (kl_upsert_source). */
    sourceId: uuid("source_id").references(() => knowledgeSources.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id").references(() => sourceRevisions.id, {
      onDelete: "cascade",
    }),
    /** The principal that created the job (JWT subject); status reads are scoped to it. */
    createdBy: text("created_by"),
    /** Idempotency key: a repeated delivery finds the existing job instead of a new one. */
    dedupeKey: text("dedupe_key"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    payload: jsonb("payload").notNull().default({}),
    /** Card-extraction coverage: processedChars, totalChars, windows, failedWindows. */
    coverage: jsonb("coverage"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("ingestion_jobs_claim_idx").on(table.status, table.nextAttemptAt),
    index("ingestion_jobs_material_idx").on(table.materialId),
    index("ingestion_jobs_revision_idx").on(table.revisionId),
    uniqueIndex("ingestion_jobs_tenant_dedupe_uidx")
      .on(table.tenantId, table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
    check(
      "ingestion_jobs_status_check",
      sql`${table.status} IN ('queued', 'indexing', 'text_ready', 'ready', 'retry_wait', 'failed', 'superseded', 'retracted')`,
    ),
    check("ingestion_jobs_stage_check", sql`${table.stage} IN ('index', 'cards', 'graph', 'done')`),
  ],
)

export { ingestionJobs }

export type IngestionJobSelect = typeof ingestionJobs.$inferSelect
export type IngestionJobInsert = typeof ingestionJobs.$inferInsert
