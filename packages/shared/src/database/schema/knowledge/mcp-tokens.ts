import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
 * Registry of issued MCP bearer tokens (typ="mcp"). External chat clients
 * (Claude Desktop, Cursor, …) authenticate to /api/mcp with one of these.
 *
 * This doubles as the revocation store: the MCP route fails CLOSED — a token
 * whose jti is absent here (or has revoked_at set, or is past expires_at) is
 * rejected. So issuing a token inserts a row; revoking sets revoked_at. This
 * mirrors the Go RevocationChecker's "unknown jti → fail closed" contract.
 */
const mcpTokens = pgTable(
  "mcp_tokens",
  {
    jti: text("jti").primaryKey(),
    /** The principal this token acts as (the agent / service / human id). */
    userUuid: text("user_uuid").notNull(),
    /** Principal kind — agent-first by default. */
    actorType: text("actor_type").notNull().default("agent"),
    /** Granted capability scopes (least-privilege): knowledge:read, knowledge:signal, … */
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{knowledge:read}'::text[]`),
    label: text("label").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("mcp_tokens_user_uuid_idx").on(table.userUuid, table.createdAt.desc()),
    index("mcp_tokens_active_idx").on(table.revokedAt, table.expiresAt),
  ],
)

type McpTokenInsert = typeof mcpTokens.$inferInsert
type McpTokenSelect = typeof mcpTokens.$inferSelect

export { mcpTokens, type McpTokenInsert, type McpTokenSelect }
