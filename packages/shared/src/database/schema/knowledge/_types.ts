import { customType } from "drizzle-orm/pg-core"

/**
 * Postgres `tsvector` column type for full-text search.
 *
 * Drizzle has no built-in tsvector helper. The knowledge tables carry a
 * generated `body_tsv` column that merges three FTS configs (simple/english/
 * russian) with setweight, mirroring the Go service's BM25 retrieval path.
 */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector"
  },
})
