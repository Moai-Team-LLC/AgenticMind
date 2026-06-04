import { sql } from "drizzle-orm"
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/** Principal kind — what the identity represents. Agent-first by default. */
const principalKindEnum = pgEnum("principal_kind", ["agent", "service", "human"])

/**
 * Principals. The table keeps the name `users` for FK stability (knowledge_settings,
 * mcp_tokens reference it), but an AgenticMind principal is an agent / service /
 * human identity that owns MCP tokens, asks questions, and is attributed in the
 * trace. There is no stored human profile — caller context travels per-call as
 * `CallerContext`, not as a stored row.
 */
const users = pgTable(
  "users",
  {
    uuid: uuid("uuid").primaryKey().defaultRandom(),
    kind: principalKindEnum("kind").notNull().default("agent"),
    /** Stable external identifier (e.g. the agent's id in the host system). */
    externalId: text("external_id"),
    /** Human-readable label for dashboards / audit. */
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("users_external_id_idx").on(table.externalId),
    index("users_kind_idx").on(table.kind),
  ],
)

type UserInsert = typeof users.$inferInsert
type UserSelect = typeof users.$inferSelect

export { users, principalKindEnum, type UserInsert, type UserSelect }
