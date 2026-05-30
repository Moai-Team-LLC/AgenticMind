import { tsvector } from "@agenticmind/shared/database/schema/knowledge/_types"
import { sql } from "drizzle-orm"
import { index, pgTable, real, text, timestamp, uuid, vector } from "drizzle-orm/pg-core"

/**
 * Bitemporal belief store — the heart of agentic memory + thinking.
 *
 * One row = one belief: a subject-predicate-object fact held by an actor, with
 * provenance, confidence, and TWO time axes:
 *   - valid_from / valid_to  — when the fact is true in the WORLD (valid time)
 *   - recorded_at / invalidated_at — when the actor LEARNED / RETRACTED it (tx time)
 *
 * Two tiers share this table via `actor_uuid`:
 *   - actor_uuid = <agent>  → that agent's PRIVATE memory (what it observed/inferred)
 *   - actor_uuid IS NULL    → SHARED / collective memory (consolidated, corroborated)
 *
 * Belief revision is non-destructive: a contradicting belief supersedes the old
 * one (sets the old row's valid_to + invalidated_at and links via `supersedes`),
 * so the history — "what did agent X believe at time T" — is always replayable.
 */
const beliefs = pgTable(
  "beliefs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Holder of the belief. NULL = shared/collective memory. */
    actorUuid: text("actor_uuid"),

    // subject-predicate-object (free text; mirrors the card/graph ontology)
    subject: text("subject").notNull(),
    predicate: text("predicate").notNull(),
    object: text("object").notNull(),

    // valid time (world)
    validFrom: timestamp("valid_from", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),

    // transaction time (knowledge)
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    /** Set when this belief is retracted/superseded (tx-time death). */
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    /** The belief this one replaced (revision chain). */
    supersedes: uuid("supersedes"),

    confidence: real("confidence").notNull().default(0.5),

    // provenance
    /** material | agent | judge | consolidation */
    sourceKind: text("source_kind").notNull().default("agent"),
    sourceId: text("source_id"),

    embedding: vector("embedding", { dimensions: 1536 }),
    objectTsv: tsvector("object_tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(object,'')), 'A') || setweight(to_tsvector('english', coalesce(object,'')), 'B')`,
    ),

    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    // "current beliefs for an actor about a subject" — the hot recall path.
    index("beliefs_actor_subject_idx").on(table.actorUuid, table.subject),
    index("beliefs_subject_predicate_idx").on(table.subject, table.predicate),
    // current = invalidated_at IS NULL AND valid_to IS NULL
    index("beliefs_current_idx").on(table.invalidatedAt, table.validTo),
    index("beliefs_embedding_idx").using("diskann", table.embedding.op("vector_cosine_ops")),
    index("beliefs_object_tsv_idx").using("gin", table.objectTsv),
  ],
)

type BeliefInsert = typeof beliefs.$inferInsert
type BeliefSelect = typeof beliefs.$inferSelect

export { beliefs, type BeliefInsert, type BeliefSelect }
