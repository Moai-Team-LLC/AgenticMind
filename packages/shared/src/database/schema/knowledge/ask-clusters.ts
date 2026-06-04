import { EMBEDDING_DIMENSIONS } from "@agenticmind/shared/database/schema/knowledge/_config"
import { tenantColumn } from "@agenticmind/shared/database/schema/knowledge/_tenant"
import { knowledgeCards } from "@agenticmind/shared/database/schema/knowledge/knowledge-cards"
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  vector,
  uuid,
} from "drizzle-orm/pg-core"

/**
 * Clusters of semantically-similar /ask questions. A nightly sweep groups
 * recent asks by question_embedding cosine ≥ 0.85 around an L2-normalised
 * centroid. State machine: open → ready → promoted | vetoed.
 */
const askClusters = pgTable(
  "ask_clusters",
  {
    ...tenantColumn,
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    representativeQ: text("representative_q").notNull(),
    centroidEmbedding: vector("centroid_embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    aggregateScore: real("aggregate_score").notNull().default(0),
    memberCount: integer("member_count").notNull().default(0),
    feedbackCount: integer("feedback_count").notNull().default(0),
    state: text("state").notNull().default("open"),
    promotedCardId: uuid("promoted_card_id").references(() => knowledgeCards.id, {
      onDelete: "set null",
    }),
    vetoReason: text("veto_reason"),
    judgeVerdict: text("judge_verdict"),
    judgeRationale: text("judge_rationale"),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("ask_clusters_centroid_idx").using(
      "diskann",
      table.centroidEmbedding.op("vector_cosine_ops"),
    ),
    index("ask_clusters_state_idx").on(table.state, table.aggregateScore.desc()),
    index("ask_clusters_updated_at_idx").on(table.updatedAt.desc()),
    check(
      "ask_clusters_state_check",
      sql`${table.state} IN ('open', 'ready', 'promoted', 'vetoed')`,
    ),
  ],
)

type AskClusterInsert = typeof askClusters.$inferInsert
type AskClusterSelect = typeof askClusters.$inferSelect

export { askClusters, type AskClusterInsert, type AskClusterSelect }
