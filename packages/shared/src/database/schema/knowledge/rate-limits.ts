import { tenantColumn } from "@agenticmind/shared/database/schema/knowledge/_tenant"
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
 * Fixed-window rate-limit counters, keyed by principal (or principal:tool).
 * `checkRateLimit` upserts atomically — no Redis needed; the flagship stays
 * Postgres-only.
 */
const rateLimits = pgTable("rate_limits", {
  ...tenantColumn,
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
})

type RateLimitSelect = typeof rateLimits.$inferSelect

export { rateLimits, type RateLimitSelect }
