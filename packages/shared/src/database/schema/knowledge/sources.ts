import type { AnyPgColumn } from "drizzle-orm/pg-core"

import { tenantColumn } from "@agenticmind/shared/database/schema/knowledge/_tenant"
import { materials } from "@agenticmind/shared/database/schema/knowledge/materials"
import { sql } from "drizzle-orm"
import {
  bigint,
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
 * Sources (contract 1.11.0): a thing at a provider — a meeting, a document, a
 * chat thread, a file in a repository — delivered again and again. Identity is
 * (tenant, connection_id, source_type, external_id). The creating principal
 * owns it (`owner`). `current_revision_id` points at the revision answers use;
 * it moves only once the new revision's passages are searchable.
 * `latest_external_version` is the highest provider version received, so an
 * older delivery can be told apart (`stale`).
 */
const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    ...tenantColumn,
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    connectionId: text("connection_id").notNull().default("default"),
    sourceType: text("source_type").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    knowledgeType: text("knowledge_type").notNull().default("canonical"),
    ftsConfig: text("fts_config").notNull().default("simple"),
    visibility: text("visibility").notNull().default("workspace"),
    recipients: jsonb("recipients").notNull().default([]),
    owner: text("owner"),
    currentRevisionId: uuid("current_revision_id").references(
      (): AnyPgColumn => sourceRevisions.id,
      { onDelete: "set null" },
    ),
    latestExternalVersion: bigint("latest_external_version", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_sources_identity_uidx").on(
      table.tenantId,
      table.connectionId,
      table.sourceType,
      table.externalId,
    ),
    index("knowledge_sources_type_idx").on(table.sourceType),
    check(
      "knowledge_sources_knowledge_type_check",
      sql`${table.knowledgeType} IN ('canonical', 'evidence', 'inference')`,
    ),
    check(
      "knowledge_sources_visibility_check",
      sql`${table.visibility} IN ('workspace', 'restricted', 'personal')`,
    ),
  ],
)

/**
 * One delivered version of a source. `content_hash` is sha256 of the
 * normalized content, computed by the server; `content_text` is the text that
 * was indexed (for a dialogue, its segments rendered as "speaker: text" lines)
 * and `segments` the utterances as delivered. Each revision is indexed as its
 * own material (`material_id`), so an older revision stays readable and
 * searchable in history while the current one answers.
 */
const sourceRevisions = pgTable(
  "source_revisions",
  {
    ...tenantColumn,
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sourceId: uuid("source_id")
      .notNull()
      .references((): AnyPgColumn => knowledgeSources.id, { onDelete: "cascade" }),
    /** 1, 2, 3 … per source, in the order revisions were accepted. */
    revisionNo: integer("revision_no").notNull(),
    contentHash: text("content_hash").notNull(),
    externalVersion: bigint("external_version", { mode: "number" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    contentText: text("content_text").notNull(),
    segments: jsonb("segments"),
    provenance: jsonb("provenance"),
    warnings: jsonb("warnings").notNull().default([]),
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("source_revisions_source_no_uidx").on(table.sourceId, table.revisionNo),
    index("source_revisions_source_hash_idx").on(table.sourceId, table.contentHash),
    index("source_revisions_material_idx").on(table.materialId),
  ],
)

/**
 * The tenant's corpus revision: a counter that increases whenever what answers
 * changes — a source switching its current revision (and, later, a retraction).
 * Reported with each answer, so a caller can tell answers over different corpora
 * apart. One row per tenant; the key is the tenant column itself.
 */
const knowledgeCorpus = pgTable(
  "knowledge_corpus",
  {
    ...tenantColumn,
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [uniqueIndex("knowledge_corpus_tenant_uidx").on(table.tenantId)],
)

export { knowledgeCorpus, knowledgeSources, sourceRevisions }

export type KnowledgeSourceSelect = typeof knowledgeSources.$inferSelect
export type SourceRevisionSelect = typeof sourceRevisions.$inferSelect
