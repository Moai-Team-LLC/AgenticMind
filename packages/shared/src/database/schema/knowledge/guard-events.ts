import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Security audit log — one row per blocked / redacted request. Stores a HASH
 * of the offending input, never the text (the doc's RedactionEvent contract):
 * an admin can see that something was blocked, by whom, and why, without the
 * incident text leaking into the logs.
 */
const guardEvents = pgTable(
  "guard_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** The acting principal (agent), if known. */
    actorUuid: text("actor_uuid"),
    /** The tool the block happened in (kl_ask_global, mem_write, …). */
    tool: text("tool").notNull(),
    /** Injection | pii_redacted | rate_limited | output_leak | too_long */
    reason: text("reason").notNull(),
    /** Sha256 of the offending input — never the raw text. */
    inputHash: text("input_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("guard_events_actor_time_idx").on(table.actorUuid, table.createdAt.desc()),
    index("guard_events_reason_time_idx").on(table.reason, table.createdAt.desc()),
  ],
)

type GuardEventInsert = typeof guardEvents.$inferInsert

export { guardEvents, type GuardEventInsert }
