import {
  EMBEDDING_DIMENSIONS,
  FTS_CONFIG,
} from "@agenticmind/shared/database/schema/knowledge/_config"
import { tsvector } from "@agenticmind/shared/database/schema/knowledge/_types"
import { materials } from "@agenticmind/shared/database/schema/knowledge/materials"
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core"

/**
 * Typed, ontology-validated knowledge cards extracted at ingest. Retrieved
 * ahead of raw chunks with a 1.3× boost. subject_type/predicate are validated
 * against the V0 ontology at write time (kept as text, not enums).
 */
const knowledgeCards = pgTable(
  "knowledge_cards",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectValue: text("subject_value").notNull(),
    predicate: text("predicate"),
    value: text("value"),
    body: text("body").notNull(),
    question: text("question"),
    spanStart: integer("span_start"),
    spanEnd: integer("span_end"),
    confidence: real("confidence").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    extractorVersion: text("extractor_version"),
    bodyTsv: tsvector("body_tsv").generatedAlwaysAs(
      sql`to_tsvector('${sql.raw(FTS_CONFIG)}', coalesce(body, ''))`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("knowledge_cards_material_id_idx").on(table.materialId),
    index("knowledge_cards_subject_idx").on(table.subjectType, table.subjectValue),
    index("knowledge_cards_kind_confidence_idx").on(table.kind, table.confidence),
    index("knowledge_cards_extractor_version_idx").on(table.extractorVersion, table.materialId),
    index("knowledge_cards_embedding_idx").using(
      "diskann",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("knowledge_cards_body_tsv_idx").using("gin", table.bodyTsv),
    check(
      "knowledge_cards_kind_check",
      sql`${table.kind} IN ('fact', 'qa', 'definition', 'metric', 'procedure', 'resolution')`,
    ),
    check(
      "knowledge_cards_confidence_check",
      sql`${table.confidence} >= 0.0 AND ${table.confidence} <= 1.0`,
    ),
  ],
)

type KnowledgeCardInsert = typeof knowledgeCards.$inferInsert
type KnowledgeCardSelect = typeof knowledgeCards.$inferSelect

export { knowledgeCards, type KnowledgeCardInsert, type KnowledgeCardSelect }
