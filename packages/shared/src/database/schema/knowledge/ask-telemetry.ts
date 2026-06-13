import { tenantColumn } from "@agenticmind/shared/database/schema/knowledge/_tenant"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

/**
 * Per-request audit trail of /ask answers. Privacy: only the sha256 of the
 * normalised question is stored, never the question text. Feeds the
 * observability panel (latency/cost by served_by path).
 */
const askTelemetry = pgTable(
  "ask_telemetry",
  {
    ...tenantColumn,
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    memberId: text("member_id"),
    questionHash: text("question_hash").notNull(),
    // The raw question text — NULL by default (privacy). Populated only when the
    // opt-in eval-harvest flag (KNOWLEDGE_EVAL_HARVEST) is set, so signalled real
    // queries can be replayed by the corpus-adaptive tuner (scripts/tune.ts).
    questionText: text("question_text"),
    servedBy: text("served_by").notNull(),
    retrievalMs: integer("retrieval_ms").notNull(),
    generationMs: integer("generation_ms").notNull(),
    model: text("model").notNull(),
    citationCount: integer("citation_count").notNull(),
    answerChars: integer("answer_chars").notNull(),
    rerankUsed: boolean("rerank_used").notNull().default(false),
    rerankLatencyMs: integer("rerank_latency_ms"),
    phases: jsonb("phases")
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("ask_telemetry_created_at_idx").on(table.createdAt.desc()),
    index("ask_telemetry_served_by_time_idx").on(table.servedBy, table.createdAt.desc()),
    index("ask_telemetry_question_time_idx").on(table.questionHash, table.createdAt.desc()),
    check(
      "ask_telemetry_served_by_check",
      sql`${table.servedBy} IN ('cache', 'card_synth', 'synth')`,
    ),
  ],
)

type AskTelemetryInsert = typeof askTelemetry.$inferInsert
type AskTelemetrySelect = typeof askTelemetry.$inferSelect

export { askTelemetry, type AskTelemetryInsert, type AskTelemetrySelect }
