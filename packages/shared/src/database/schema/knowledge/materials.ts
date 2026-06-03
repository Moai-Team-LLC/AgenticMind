import { sql } from "drizzle-orm"
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Materials are the unit of knowledge: PDF, DOCX, web page, Notion page,
 * Telegram chat, etc. The knowledge layer does not own principals —
 * `created_by` is an opaque text id (the JWT subject), so there is no
 * cross-table FK to enforce here.
 *
 * status pipeline: ingesting → chunking → embedding → embedded | failed
 */
const materials = pgTable(
  "materials",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    title: text("title").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull().default("ingesting"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storageUri: text("storage_uri"),
    sourceUrl: text("source_url"),
    createdBy: text("created_by"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("materials_status_idx").on(table.status),
    index("materials_source_idx").on(table.source),
    index("materials_created_by_idx").on(table.createdBy),
    index("materials_created_at_idx").on(table.createdAt.desc()),
    index("materials_title_trgm_idx").using("gin", sql`lower(${table.title}) gin_trgm_ops`),
    check("materials_source_check", sql`${table.source} IN ('manual')`),
    check(
      "materials_status_check",
      sql`${table.status} IN ('ingesting', 'chunking', 'embedding', 'embedded', 'failed')`,
    ),
  ],
)

type MaterialInsert = typeof materials.$inferInsert
type MaterialSelect = typeof materials.$inferSelect

export { materials, type MaterialInsert, type MaterialSelect }
