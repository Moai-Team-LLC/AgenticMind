import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
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
  vector,
} from "drizzle-orm/pg-core"

/**
 * Semantic answer cache: pre-computed (question → answer + citations) pairs
 * reused until source materials change or TTL expires. Two-stage lookup:
 * exact question_hash, then cosine ≥ 0.92 on question_embedding. Soft-deleted
 * via invalidated_at (partial unique/diskann/gin indexes filter on active).
 */
const answerCache = pgTable(
  "answer_cache",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    questionHash: text("question_hash").notNull(),
    questionText: text("question_text").notNull(),
    questionEmbedding: vector("question_embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    answerText: text("answer_text").notNull(),
    citationsJson: jsonb("citations_json")
      .notNull()
      .default(sql`'[]'::jsonb`),
    sourceMaterialIds: uuid("source_material_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    sourceFingerprint: text("source_fingerprint").notNull(),
    answerModel: text("answer_model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    ttlSeconds: integer("ttl_seconds").notNull().default(604_800),
    hitCount: integer("hit_count").notNull().default(0),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedReason: text("invalidated_reason"),
  },
  (table) => [
    uniqueIndex("answer_cache_active_hash_uniq")
      .on(table.questionHash)
      .where(sql`invalidated_at IS NULL`),
    index("answer_cache_question_embedding_idx")
      .using("diskann", table.questionEmbedding.op("vector_cosine_ops"))
      .where(sql`invalidated_at IS NULL`),
    index("answer_cache_source_ids_gin_idx")
      .using("gin", table.sourceMaterialIds)
      .where(sql`invalidated_at IS NULL`),
    index("answer_cache_created_at_idx")
      .on(table.createdAt)
      .where(sql`invalidated_at IS NULL`),
    check(
      "answer_cache_ttl_check",
      sql`${table.ttlSeconds} > 0 AND ${table.ttlSeconds} <= 2592000`,
    ),
  ],
)

type AnswerCacheInsert = typeof answerCache.$inferInsert
type AnswerCacheSelect = typeof answerCache.$inferSelect

export { answerCache, type AnswerCacheInsert, type AnswerCacheSelect }
