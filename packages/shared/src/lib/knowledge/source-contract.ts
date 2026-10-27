/**
 * MCP contract 1.11.0 — sources, revisions and their lifecycle.
 *
 * Shapes only: the input schemas of the source tools, the optional fields added
 * to existing tools, and the output envelopes a client can rely on. The handlers
 * that fill these envelopes land separately, so the contract can be reviewed and
 * frozen before the storage work behind it. CONTRACT.md describes the semantics;
 * mcp-contract.test.ts and __contract__/source-tools.schema.json freeze the shapes.
 */

import { SUPPORTED_LANGUAGES } from "@agenticmind/shared/database/schema/knowledge/_config"
import * as z from "zod"

/**
 * Retrieval modes. Omitted = the pre-1.11 behaviour (current revisions only, no
 * filtering by knowledge type), so existing callers see no change.
 * - `current`: canonical knowledge only, active lifecycle, current revisions.
 * - `research`: every knowledge type, each hit labelled, current revisions.
 * - `history`: as research, plus superseded revisions (`isCurrent: false`).
 */
export const SEARCH_MODES = ["current", "research", "history"] as const
export type SearchMode = (typeof SEARCH_MODES)[number]

/**
 * What a source's content stands for. `canonical`: authoritative (approved
 * decisions, maintained documentation). `evidence`: a record of what was said or
 * observed (an interview, a chat); saying something does not make it true.
 * `inference`: produced by a model (a generated summary).
 */
export const KNOWLEDGE_TYPES = ["canonical", "evidence", "inference"] as const
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number]

/**
 * Who may see a source. Only `workspace` is accepted until per-document access
 * control ships; `restricted` and `personal` are reserved so it can land
 * without a contract change, and are refused with an explicit error until then.
 */
export const VISIBILITIES = ["workspace", "restricted", "personal"] as const
export type Visibility = (typeof VISIBILITIES)[number]
export const SUPPORTED_VISIBILITIES: readonly Visibility[] = ["workspace"]

/** Background indexing job statuses (kl_get_ingestion_status). */
export const INGESTION_STATUSES = [
  "queued",
  "indexing",
  "text_ready",
  "ready",
  "retry_wait",
  "failed",
  "superseded",
  "retracted",
] as const
export type IngestionStatus = (typeof INGESTION_STATUSES)[number]

/** Outcomes of kl_upsert_source (and of kl_ingest with `source`). */
export const UPSERT_OUTCOMES = ["accepted", "unchanged", "stale", "conflict", "retracted"] as const
export type UpsertOutcome = (typeof UPSERT_OUTCOMES)[number]

/** Outcomes of kl_set_source_availability. */
export const AVAILABILITY_OUTCOMES = ["updated", "unchanged", "not_found"] as const

/** Largest normalized text one revision may carry — the same bound as kl_ingest. */
export const MAX_REVISION_CHARS = 200_000
/** Largest number of dialogue segments in one revision. */
export const MAX_REVISION_SEGMENTS = 5000
/** kl_read_source: default and largest number of characters returned per call. */
export const READ_SOURCE_DEFAULT_CHARS = 20_000
export const READ_SOURCE_MAX_CHARS = 100_000

// --- Building blocks -------------------------------------------------------

/** Lower-case kind of source, e.g. `meeting`, `chat_message`, `repo_file`. */
const sourceType = z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/u)
/** The provider's own id for the source; unique within (connection, type). */
const externalId = z.string().min(1).max(512)
/** The integration instance the source came through; omitted = `default`. */
const connectionId = z.string().min(1).max(128)
const isoInstant = z.iso.datetime({ offset: true })
const reason = z.string().min(1).max(500)

/** One utterance of a dialogue. Order in the array is the segment index. */
export const transcriptSegment = z.object({
  speaker: z.string().min(1).max(200).nullable().optional(),
  /** The provider's stable id for the speaker, when it has one. */
  speakerId: z.string().min(1).max(200).nullable().optional(),
  text: z.string().min(1).max(20_000),
  startMs: z.number().int().min(0).nullable().optional(),
  endMs: z.number().int().min(0).nullable().optional(),
})

/** Where a revision's content came from in a code host or a running system. */
export const provenance = z.object({
  repo: z.string().min(1).max(300).optional(),
  path: z.string().min(1).max(1000).optional(),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/u)
    .optional(),
  ref: z.string().min(1).max(300).optional(),
  /** The deployment environment this content describes, e.g. `production`. */
  environment: z.string().min(1).max(100).optional(),
})

/** A time window over a revision's `occurredAt` (falls back to capture time). */
export const period = z.object({ from: isoInstant.optional(), to: isoInstant.optional() })

/** Extra fields kl_search and kl_ask_global accept from 1.11.0. */
export const retrievalScopeFields = {
  mode: z.enum(SEARCH_MODES).optional(),
  /** Only sources of these types (materials without a source never match). */
  sourceTypes: z.array(sourceType).max(20).optional(),
  period: period.optional(),
}

/** The source identity kl_ingest may carry from 1.11.0 (idempotent ingest). */
export const ingestSourceField = z.object({
  sourceType,
  externalId,
  connectionId: connectionId.optional(),
  sourceUrl: z.url().max(2048).optional(),
  knowledgeType: z.enum(KNOWLEDGE_TYPES).optional(),
})

/** Extra fields kl_forget accepts from 1.11.0 (retract a source). */
export const forgetSourceFields = {
  /** With `sourceType`, `id` is the source's external ID within that type. */
  sourceType: sourceType.optional(),
  connectionId: connectionId.optional(),
  /** Why — kept in the audit trail. */
  reason: reason.optional(),
}

// --- New tools: inputs -----------------------------------------------------

export const klUpsertSourceInput = z.object({
  source: z.object({
    sourceType,
    externalId,
    connectionId: connectionId.optional(),
    title: z.string().min(1).max(300).optional(),
    sourceUrl: z.url().max(2048).optional(),
    /** Default `canonical`. Applies to every revision of the source. */
    knowledgeType: z.enum(KNOWLEDGE_TYPES).optional(),
    language: z.enum(SUPPORTED_LANGUAGES).optional(),
    /** Default `workspace`; see VISIBILITIES. Fixed when the source is created. */
    visibility: z.enum(VISIBILITIES).optional(),
    /** Principals (and `group:<name>`) for `restricted` / `personal`. */
    recipients: z.array(z.string().min(1).max(200)).max(200).optional(),
  }),
  /** Exactly one of `text` and `segments`. */
  revision: z.object({
    text: z.string().min(1).max(MAX_REVISION_CHARS).optional(),
    segments: z.array(transcriptSegment).max(MAX_REVISION_SEGMENTS).optional(),
    /** The provider's ordering of versions; an older one never replaces a newer. */
    externalVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    /** When the recorded event happened (not when it was delivered). */
    occurredAt: isoInstant.optional(),
    provenance: provenance.optional(),
    /** Known limits of this content, shown with it ("no timecodes", "partial"). */
    warnings: z.array(z.string().min(1).max(500)).max(20).optional(),
  }),
  /** Optimistic lock: the revision the caller believes is current; `null` =
   * the caller expects no current revision yet. Omitted = no expectation. */
  expectedRevisionId: z.uuid().nullable().optional(),
  /** Bring a retracted source back. Requires knowledge:admin. */
  allowResurrect: z.boolean().optional(),
})

export const klGetIngestionStatusInput = z.object({ jobId: z.uuid() })

export const klReadSourceInput = z.object({
  sourceId: z.uuid(),
  /** A specific revision (e.g. the one an old answer cited). Default: current. */
  revisionId: z.uuid().optional(),
  /** Inclusive segment range, for dialogue revisions. */
  range: z
    .object({
      fromSegment: z.number().int().min(0),
      toSegment: z.number().int().min(0),
    })
    .optional(),
  /** Character offset into the normalized text, for paging a text revision. */
  offset: z.number().int().min(0).optional(),
  maxChars: z.number().int().positive().max(READ_SOURCE_MAX_CHARS).optional(),
})

export const klSetSourceAvailabilityInput = z.object({
  sourceType,
  externalId,
  connectionId: connectionId.optional(),
  available: z.boolean(),
  reason,
})

// --- Outputs ---------------------------------------------------------------

const segmentRange = z.object({ from: z.number().int(), to: z.number().int() })

/** Source fields a search hit or a citation carries; null for a material
 * ingested without a source. */
export const sourceRef = z.object({
  sourceId: z.uuid().nullable(),
  revisionId: z.uuid().nullable(),
  sourceType: z.string().nullable(),
  isCurrent: z.boolean(),
  knowledgeType: z.enum(KNOWLEDGE_TYPES),
  occurredAt: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  segmentRange: segmentRange.nullable(),
  speaker: z.string().nullable(),
  startMs: z.number().int().nullable(),
  endMs: z.number().int().nullable(),
  provenance: provenance.nullable(),
  warnings: z.array(z.string()),
})

export const klUpsertSourceOutput = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("accepted"),
    sourceId: z.uuid(),
    revisionId: z.uuid(),
    jobId: z.uuid(),
    contentHash: z.string(),
    /** True when this call created the source. */
    created: z.boolean(),
  }),
  z.object({
    outcome: z.literal("unchanged"),
    sourceId: z.uuid(),
    revisionId: z.uuid(),
    /** The job still indexing that revision, or null when it is done. */
    jobId: z.uuid().nullable(),
    contentHash: z.string(),
  }),
  z.object({
    outcome: z.literal("stale"),
    sourceId: z.uuid(),
    currentRevisionId: z.uuid().nullable(),
  }),
  z.object({
    outcome: z.literal("conflict"),
    sourceId: z.uuid().nullable(),
    currentRevisionId: z.uuid().nullable(),
  }),
  z.object({ outcome: z.literal("retracted"), sourceId: z.uuid() }),
])

export const klGetIngestionStatusOutput = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    jobId: z.uuid(),
    status: z.enum(INGESTION_STATUSES),
    sourceId: z.uuid().nullable(),
    revisionId: z.uuid().nullable(),
    materialId: z.uuid().nullable(),
    /** Whether the job's revision is the source's current one. */
    isCurrent: z.boolean(),
    attempts: z.number().int(),
    /** Card extraction over the whole text: characters covered and windows. */
    coverage: z
      .object({
        processedChars: z.number().int(),
        totalChars: z.number().int(),
        windows: z.number().int(),
        failedWindows: z.number().int(),
      })
      .nullable(),
    /** A safe description of the last failure, never a stack trace. */
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    updatedAt: z.string(),
  }),
])

export const klReadSourceOutput = z.discriminatedUnion("found", [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    sourceId: z.uuid(),
    revisionId: z.uuid(),
    isCurrent: z.boolean(),
    sourceType: z.string(),
    externalId: z.string(),
    connectionId: z.string(),
    title: z.string(),
    sourceUrl: z.string().nullable(),
    knowledgeType: z.enum(KNOWLEDGE_TYPES),
    visibility: z.enum(VISIBILITIES),
    occurredAt: z.string().nullable(),
    capturedAt: z.string(),
    /** sha256 of the normalized content; equal to the revision's stored hash. */
    contentHash: z.string(),
    provenance: provenance.nullable(),
    warnings: z.array(z.string()),
    totalChars: z.number().int(),
    totalSegments: z.number().int().nullable(),
    /** The returned slice: `text` for a text revision, `segments` for a dialogue. */
    text: z.string().nullable(),
    segments: z
      .array(
        z.object({
          index: z.number().int(),
          speaker: z.string().nullable(),
          speakerId: z.string().nullable(),
          text: z.string(),
          startMs: z.number().int().nullable(),
          endMs: z.number().int().nullable(),
        }),
      )
      .nullable(),
    range: z.object({ fromSegment: z.number().int(), toSegment: z.number().int() }).nullable(),
    offset: z.number().int().nullable(),
    /** Where the next page starts, or null when this slice reaches the end. */
    nextOffset: z.number().int().nullable(),
    truncated: z.boolean(),
  }),
])

export const klSetSourceAvailabilityOutput = z.object({
  outcome: z.enum(AVAILABILITY_OUTCOMES),
})

/** Fields kl_ingest's result gains (1.11.0). With `source`, the result is a
 * kl_upsert_source envelope plus `materialId`. */
export const klIngestOutputFields = z.object({
  /** `ready`, or `text_ready` when passages are searchable and cards still run. */
  status: z.enum(INGESTION_STATUSES),
  /** The background job finishing this ingest, or null when nothing is left. */
  jobId: z.uuid().nullable(),
})

/** kl_forget's result when it retracts a source (1.11.0). */
export const klForgetSourceOutput = z.object({
  id: z.string(),
  retracted: z.boolean(),
  sourceId: z.uuid().optional(),
  tombstonedAt: z.string().optional(),
  /** The background job that removes revisions and derived data (≤ 24 h). */
  purgeJobId: z.uuid().optional(),
})
