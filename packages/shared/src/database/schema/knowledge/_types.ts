import { customType } from "drizzle-orm/pg-core"

/**
 * Postgres `tsvector` column type for full-text search.
 *
 * Drizzle has no built-in tsvector helper. The knowledge tables carry a
 * generated `*_tsv` column built under the configured FTS_CONFIG (default
 * `simple`, language-neutral), serving the BM25 retrieval path.
 */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector"
  },
})
