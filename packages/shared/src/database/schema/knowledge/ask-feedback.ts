import { askTelemetry } from "@agenticmind/shared/database/schema/knowledge/ask-telemetry"
import { sql } from "drizzle-orm"
import { check, index, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Per-event signals collected after an /ask response. Aggregated into
 * question clusters; once a cluster passes threshold the best answer is
 * promoted to a resolution card. Signal vocabulary is a closed CHECK list.
 */
const askFeedback = pgTable(
  "ask_feedback",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    askId: uuid("ask_id").references(() => askTelemetry.id, { onDelete: "set null" }),
    memberId: text("member_id"),
    signal: text("signal").notNull(),
    strength: real("strength").notNull(),
    source: text("source").notNull(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("ask_feedback_ask_id_idx").on(table.askId),
    index("ask_feedback_member_time_idx").on(table.memberId, table.createdAt.desc()),
    index("ask_feedback_created_at_idx").on(table.createdAt.desc()),
    check(
      "ask_feedback_signal_check",
      sql`${table.signal} IN ('thumb_up', 'thumb_down', 'forwarded_answer', 'thanks_message', 'silent_no_followup', 'no_repeat_in_window', 'reformulated_immediately', 'repeat_question_24h', 'verified_supported', 'verification_failed', 'eval_passed', 'eval_failed', 'downstream_success', 'downstream_failure', 'used_in_generation')`,
    ),
    check(
      "ask_feedback_strength_check",
      sql`${table.strength} >= -1.0 AND ${table.strength} <= 1.0`,
    ),
  ],
)

type AskFeedbackInsert = typeof askFeedback.$inferInsert
type AskFeedbackSelect = typeof askFeedback.$inferSelect

export { askFeedback, type AskFeedbackInsert, type AskFeedbackSelect }
