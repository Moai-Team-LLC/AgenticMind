import { tenantColumn } from "@agenticmind/shared/database/schema/knowledge/_tenant"
import { materials } from "@agenticmind/shared/database/schema/knowledge/materials"
import { sql } from "drizzle-orm"
import { index, pgTable, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Postgres-backed GraphRAG (Layer-2). Ports the Neo4j model
 * ((:Material)-[:MENTIONS]->(:Entity)-[:RELATED]->(:Entity)) to three tables so
 * the flagship runs on Postgres alone. Entity identity is content-derived
 * (`entity_id` = sha1(canonical_name|type)[:32]) so re-extraction converges
 * instead of duplicating nodes. Neo4j remains an enterprise swap-in behind the
 * same `GraphStore` interface.
 */

const kgEntities = pgTable(
  "kg_entities",
  {
    ...tenantColumn,
    entityId: text("entity_id").primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    type: text("type").notNull(),
    /** Mapped V0 ontology type, or NULL when the entity is not in V0. */
    ontologyType: text("ontology_type"),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    confidence: real("confidence").notNull().default(0),
    extractorVersion: text("extractor_version"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("kg_entities_canonical_name_idx").on(table.canonicalName),
    index("kg_entities_ontology_type_idx").on(table.ontologyType),
  ],
)

/** (:Material)-[:MENTIONS]->(:Entity). Cascade-deletes with the material. */
const kgMentions = pgTable(
  "kg_mentions",
  {
    ...tenantColumn,
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    entityId: text("entity_id")
      .notNull()
      .references(() => kgEntities.entityId, { onDelete: "cascade" }),
    confidence: real("confidence").notNull().default(0),
    extractorVersion: text("extractor_version"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.materialId, table.entityId] }),
    index("kg_mentions_entity_id_idx").on(table.entityId),
  ],
)

/** (:Entity)-[:RELATED {predicate}]->(:Entity). */
const kgRelations = pgTable(
  "kg_relations",
  {
    ...tenantColumn,
    fromEntity: text("from_entity")
      .notNull()
      .references(() => kgEntities.entityId, { onDelete: "cascade" }),
    toEntity: text("to_entity")
      .notNull()
      .references(() => kgEntities.entityId, { onDelete: "cascade" }),
    predicate: text("predicate").notNull(),
    ontologyPredicate: text("ontology_predicate"),
    confidence: real("confidence").notNull().default(0),
    extractorVersion: text("extractor_version"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fromEntity, table.toEntity, table.predicate] }),
    index("kg_relations_from_idx").on(table.fromEntity),
    index("kg_relations_to_idx").on(table.toEntity),
  ],
)

type KgEntityInsert = typeof kgEntities.$inferInsert
type KgEntitySelect = typeof kgEntities.$inferSelect
type KgMentionInsert = typeof kgMentions.$inferInsert
type KgRelationInsert = typeof kgRelations.$inferInsert

export {
  kgEntities,
  kgMentions,
  kgRelations,
  type KgEntityInsert,
  type KgEntitySelect,
  type KgMentionInsert,
  type KgRelationInsert,
}
