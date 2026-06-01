import {
  EMBEDDING_DIMENSIONS,
  FTS_CONFIG,
} from "@agenticmind/shared/database/schema/knowledge/_config"
import { tsvector } from "@agenticmind/shared/database/schema/knowledge/_types"
import { materials } from "@agenticmind/shared/database/schema/knowledge/materials"
import { sql } from "drizzle-orm"
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core"

/**
 * Text + embedding chunks for vector + BM25 hybrid retrieval. Combined in one
 * row (no chunk/embedding split): one model, fixed EMBEDDING_DIMENSIONS dim,
 * cascade delete, vector index next to source rows.
 *
 * `body_tsv` is a generated tsvector under the configured FTS_CONFIG (default
 * `simple` — language-neutral, multilingual-safe).
 */
const chunks = pgTable(
  "chunks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    body: text("body").notNull(),
    tokenCount: integer("token_count"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    bodyTsv: tsvector("body_tsv").generatedAlwaysAs(
      sql`to_tsvector('${sql.raw(FTS_CONFIG)}', coalesce(body, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("chunks_material_ordinal_uniq").on(table.materialId, table.ordinal),
    index("chunks_material_id_idx").on(table.materialId),
    index("chunks_embedding_idx").using("diskann", table.embedding.op("vector_cosine_ops")),
    index("chunks_body_tsv_idx").using("gin", table.bodyTsv),
  ],
)

type ChunkInsert = typeof chunks.$inferInsert
type ChunkSelect = typeof chunks.$inferSelect

export { chunks, type ChunkInsert, type ChunkSelect }
