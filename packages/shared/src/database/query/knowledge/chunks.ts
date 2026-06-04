/**
 * Chunks repository. Persists chunks and serves vector (pgvector cosine) + BM25
 * (FTS_CONFIG tsvector) retrieval. Hybrid fusion of the two lists is done by
 * blendHybrid (lib/knowledge/blend). Follows the repo's { tx } + ResultAsync
 * convention.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { ScoredHit } from "@agenticmind/shared/lib/knowledge/blend"
import type { AnyColumn, SQL } from "drizzle-orm"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { chunks } from "@agenticmind/shared/database/schema"
import { SUPPORTED_LANGUAGES } from "@agenticmind/shared/database/schema/knowledge/_config"
import { toVectorLiteral } from "@agenticmind/shared/lib/knowledge/vector"
import { asc, eq, isNotNull, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

/** A chunk to persist. embedding is null until the embedder fills it in. */
export type ChunkInput = {
  ordinal: number
  body: string
  tokenCount?: number | null
  embedding?: number[] | null
  embeddingModel?: string | null
}

/** A search result. Score is cosine similarity (vector) or ts_rank_cd (BM25). */
export type KnowledgeHit = ScoredHit & {
  materialId: string
  body: string
  ordinal: number
}

/** Atomically replaces a material's chunks (delete + insert). Pass a tx for atomicity. */
export const upsertChunks = (props: {
  tx: Transaction
  materialId: string
  items: ChunkInput[]
  ftsConfig?: string
}) =>
  ResultAsync.fromPromise(
    (async () => {
      await props.tx.delete(chunks).where(eq(chunks.materialId, props.materialId))
      const config = props.ftsConfig ?? "simple"
      if (props.items.length > 0) {
        await props.tx.insert(chunks).values(
          props.items.map((c) => {
            return {
              materialId: props.materialId,
              ordinal: c.ordinal,
              body: c.body,
              tokenCount: c.tokenCount ?? null,
              embedding: c.embedding ?? null,
              embeddingModel: c.embeddingModel ?? null,
              ftsConfig: config,
              bodyTsv: sql`to_tsvector(${config}::regconfig, coalesce(${c.body}, ''))`,
            }
          }),
        )
      }
    })(),
    mapDatabaseError,
  )

export const deleteChunksByMaterial = (props: { tx: Transaction; materialId: string }) =>
  ResultAsync.fromPromise(
    props.tx.delete(chunks).where(eq(chunks.materialId, props.materialId)),
    mapDatabaseError,
  )

export const countChunksByMaterial = (props: { tx: Transaction; materialId: string }) =>
  ResultAsync.fromPromise(
    props.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(chunks)
      .where(eq(chunks.materialId, props.materialId)),
    mapDatabaseError,
  ).map((rows) => rows[0]?.count ?? 0)

/** Lists a material's chunks (embeddings omitted) ordered by ordinal asc. */
export const listChunksByMaterial = (props: {
  tx: Transaction
  materialId: string
  limit?: number
  offset?: number
}) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 500 ? props.limit : 100
  const offset = props.offset !== undefined && props.offset >= 0 ? props.offset : 0
  return ResultAsync.fromPromise(
    props.tx
      .select({
        id: chunks.id,
        materialId: chunks.materialId,
        ordinal: chunks.ordinal,
        body: chunks.body,
        tokenCount: chunks.tokenCount,
        embeddingModel: chunks.embeddingModel,
      })
      .from(chunks)
      .where(eq(chunks.materialId, props.materialId))
      .orderBy(asc(chunks.ordinal))
      .limit(limit)
      .offset(offset),
    mapDatabaseError,
  )
}

/** Vector nearest-neighbour search. Score = 1 - cosine distance (desc). */
export const searchChunks = (props: {
  tx: Transaction
  queryEmbedding: number[]
  limit?: number
  offset?: number
}): ResultAsync<KnowledgeHit[], ReturnType<typeof mapDatabaseError>> => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 100 ? props.limit : 10
  const offset = props.offset !== undefined && props.offset >= 0 ? props.offset : 0
  const literal = toVectorLiteral(props.queryEmbedding)
  return ResultAsync.fromPromise(
    props.tx
      .select({
        chunkId: chunks.id,
        materialId: chunks.materialId,
        ordinal: chunks.ordinal,
        body: chunks.body,
        score: sql<number>`1 - (${chunks.embedding} <=> ${literal}::vector)`.as("score"),
      })
      .from(chunks)
      .where(isNotNull(chunks.embedding))
      .orderBy(sql`${chunks.embedding} <=> ${literal}::vector`)
      .limit(limit)
      .offset(offset),
    mapDatabaseError,
  )
}

/** De-duplicated, trimmed variant list; falls back to [query] when empty. */
export const dedupeVariants = (query: string, variants: string[] | undefined): string[] => {
  const source = variants !== undefined && variants.length > 0 ? variants : [query]
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of source) {
    const trimmed = v.trim()
    if (trimmed === "" || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/**
 * OR-combined tsquery fragment for the given variants under the default FTS
 * config. Backwards-compatible.
 */
export const variantTsQuery = (variants: string[]): SQL => {
  const parts = variants.map((v) => sql`plainto_tsquery('simple', ${v})`)
  return sql`(${sql.join(parts, sql` || `)})`
}

/**
 * Builds an index-friendly OR-expanded WHERE clause across all supported languages
 * to allow Postgres to perform index scans on body_tsv/object_tsv.
 */
export const buildFtsWhereClause = (
  table: { ftsConfig: AnyColumn; bodyTsv: AnyColumn },
  variants: string[],
): SQL => {
  const branches = SUPPORTED_LANGUAGES.map((lang) => {
    const parts = variants.map((v) => sql`plainto_tsquery(${lang}::regconfig, ${v})`)
    const tsQuery = sql`(${sql.join(parts, sql` || `)})`
    return sql`(${table.ftsConfig} = ${lang} AND ${table.bodyTsv} @@ ${tsQuery})`
  })
  return sql`(${sql.join(branches, sql` OR `)})`
}

/**
 * BM25 full-text search over the generated body_tsv. Each variant fans into a
 * plainto_tsquery under the configured ftsConfig per-row, all OR-combined.
 */
export const searchChunksBm25 = (props: {
  tx: Transaction
  query: string
  variants?: string[]
  limit?: number
}): ResultAsync<KnowledgeHit[], ReturnType<typeof mapDatabaseError>> => {
  const variants = dedupeVariants(props.query, props.variants)
  if (variants.length === 0) {
    return ResultAsync.fromSafePromise(Promise.resolve<KnowledgeHit[]>([]))
  }
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 100 ? props.limit : 10

  const whereClause = buildFtsWhereClause(chunks, variants)

  const tsQueryParts = variants.map(
    (v) => sql`plainto_tsquery(${chunks.ftsConfig}::regconfig, ${v})`,
  )
  const tsQuery = sql`(${sql.join(tsQueryParts, sql` || `)})`

  return ResultAsync.fromPromise(
    props.tx
      .select({
        chunkId: chunks.id,
        materialId: chunks.materialId,
        ordinal: chunks.ordinal,
        body: chunks.body,
        score: sql<number>`ts_rank_cd(${chunks.bodyTsv}, ${tsQuery})`.as("score"),
      })
      .from(chunks)
      .where(whereClause)
      .orderBy(sql`ts_rank_cd(${chunks.bodyTsv}, ${tsQuery}) DESC`)
      .limit(limit),
    mapDatabaseError,
  )
}
