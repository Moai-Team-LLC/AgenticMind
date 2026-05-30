import { askClusters } from "@agenticmind/shared/database/schema/knowledge/ask-clusters"
import { askTelemetry } from "@agenticmind/shared/database/schema/knowledge/ask-telemetry"
import { sql } from "drizzle-orm"
import { index, pgTable, primaryKey, real, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Membership: which asks belong to which cluster. Many-to-one; an ask can
 * move clusters if the centroid shifts (rare).
 */
const askClusterMembers = pgTable(
  "ask_cluster_members",
  {
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => askClusters.id, { onDelete: "cascade" }),
    askId: uuid("ask_id")
      .notNull()
      .references(() => askTelemetry.id, { onDelete: "cascade" }),
    similarity: real("similarity").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clusterId, table.askId] }),
    index("ask_cluster_members_ask_id_idx").on(table.askId),
  ],
)

type AskClusterMemberInsert = typeof askClusterMembers.$inferInsert
type AskClusterMemberSelect = typeof askClusterMembers.$inferSelect

export { askClusterMembers, type AskClusterMemberInsert, type AskClusterMemberSelect }
