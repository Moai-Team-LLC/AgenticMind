/**
 * Semantic answer cache repository. Two-stage lookup (exact
 * question_hash → cosine ≥ threshold) gated by TTL + source-drift (every cited
 * material's updated_at must predate the cached answer), soft-invalidation,
 * and stats. Raw SQL via tx.execute — the CTE is beyond the query builder.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { Citation } from "@agenticmind/shared/lib/knowledge/synth"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { answerCache } from "@agenticmind/shared/database/schema"
import { hashQuestion } from "@agenticmind/shared/lib/knowledge/answer-cache-keys"
import { toVectorLiteral } from "@agenticmind/shared/lib/knowledge/vector"
import { sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600
const DEFAULT_SEMANTIC_THRESHOLD = 0.92

export type CachedAnswer = {
  id: string
  questionHash: string
  questionText: string
  answerText: string
  citations: Citation[]
  sourceMaterialIds: string[]
  sourceFingerprint: string
  answerModel: string
  ttlSeconds: number
  createdAt: Date
  hitCount: number
  lastHitAt: Date | null
}

export type StoreAnswerInput = {
  questionHash: string
  questionText: string
  questionEmbedding: number[]
  answerText: string
  citations: Citation[]
  sourceMaterialIds: string[]
  sourceFingerprint: string
  answerModel: string
  ttlSeconds?: number
}

type CacheRow = {
  id: string
  question_hash: string
  question_text: string
  answer_text: string
  citations_json: Citation[] | null
  source_material_ids: string[] | null
  source_fingerprint: string
  answer_model: string
  ttl_seconds: number
  created_at: Date
  hit_count: number
  last_hit_at: Date | null
}

const toCachedAnswer = (r: CacheRow): CachedAnswer => {
  return {
    id: r.id,
    questionHash: r.question_hash,
    questionText: r.question_text,
    answerText: r.answer_text,
    citations: r.citations_json ?? [],
    sourceMaterialIds: r.source_material_ids ?? [],
    sourceFingerprint: r.source_fingerprint,
    answerModel: r.answer_model,
    ttlSeconds: r.ttl_seconds,
    createdAt: r.created_at,
    hitCount: r.hit_count,
    lastHitAt: r.last_hit_at,
  }
}

/**
 * Two-stage lookup. Returns the cached answer or null on miss. A hit requires
 * TTL not expired AND no cited material edited since caching. Bumps hit_count
 * on hit (awaited; cheap).
 */
export const lookupAnswer = (props: {
  tx: Transaction
  question: string
  queryEmbedding: number[]
  semanticThreshold?: number
}): ResultAsync<CachedAnswer | null, ReturnType<typeof mapDatabaseError>> => {
  const hash = hashQuestion(props.question)
  const threshold = props.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD
  const maxDist = 1 - threshold
  const literal = toVectorLiteral(props.queryEmbedding)

  return ResultAsync.fromPromise(
    (async (): Promise<CachedAnswer | null> => {
      const result = await props.tx.execute(sql`
        WITH valid AS (
          SELECT a.* FROM answer_cache a
          WHERE a.invalidated_at IS NULL
            AND a.created_at + (a.ttl_seconds || ' seconds')::interval > now()
            AND NOT EXISTS (
              SELECT 1 FROM unnest(a.source_material_ids) sid
              WHERE NOT EXISTS (
                SELECT 1 FROM materials m WHERE m.id = sid AND m.updated_at < a.created_at
              )
            )
        ), hash_hit AS (
          SELECT v.*, 1 AS rank_priority FROM valid v WHERE v.question_hash = ${hash} LIMIT 1
        ), cosine_hit AS (
          SELECT v.*, 2 AS rank_priority FROM valid v
          WHERE NOT EXISTS (SELECT 1 FROM hash_hit)
            AND v.question_embedding <=> ${literal}::vector <= ${maxDist}
          ORDER BY v.question_embedding <=> ${literal}::vector
          LIMIT 1
        )
        SELECT id, question_hash, question_text, answer_text, citations_json,
               source_material_ids, source_fingerprint, answer_model,
               ttl_seconds, created_at, hit_count, last_hit_at
        FROM (
          SELECT id, question_hash, question_text, answer_text, citations_json,
                 source_material_ids, source_fingerprint, answer_model,
                 ttl_seconds, created_at, hit_count, last_hit_at, rank_priority FROM hash_hit
          UNION ALL
          SELECT id, question_hash, question_text, answer_text, citations_json,
                 source_material_ids, source_fingerprint, answer_model,
                 ttl_seconds, created_at, hit_count, last_hit_at, rank_priority FROM cosine_hit
        ) merged
        ORDER BY rank_priority ASC
        LIMIT 1
      `)
      // `tx.execute` resolves to a node-postgres QueryResult ({ rows }), not a bare
      // array — reading `result[0]` always yielded undefined, so every lookup
      // returned null and the cache never hit even with a matching row present.
      const rows = (result as unknown as { rows: CacheRow[] }).rows
      const row = rows[0]
      if (row === undefined) {
        return null
      }
      await props.tx.execute(
        sql`UPDATE answer_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE id = ${row.id}`,
      )
      return toCachedAnswer(row)
    })(),
    mapDatabaseError,
  )
}

/**
 * Postgres array literal for binding into a `uuid[]` column (`{a,b}`, `{}` empty).
 * Drizzle renders an interpolated JS array as a parenthesised value list `($n)`,
 * which Postgres rejects against a uuid[] column ("malformed array literal") — so
 * binding `${ids}` directly made every cache write fail. Cast the result
 * `::uuid[]`. Ids are uuids (hex + hyphens), safe inside the brace literal.
 */
export const pgUuidArrayLiteral = (ids: readonly string[]): string => `{${ids.join(",")}}`

/** Persists a fresh answer. ON CONFLICT on the active question_hash → no-op. */
export const storeAnswer = (props: { tx: Transaction; entry: StoreAnswerInput }) => {
  const e = props.entry
  const literal = toVectorLiteral(e.questionEmbedding)
  const ttl = e.ttlSeconds !== undefined && e.ttlSeconds > 0 ? e.ttlSeconds : DEFAULT_TTL_SECONDS
  const citationsJson = JSON.stringify(e.citations)
  const idsLiteral = pgUuidArrayLiteral(e.sourceMaterialIds)
  return ResultAsync.fromPromise(
    props.tx.execute(sql`
      INSERT INTO answer_cache (
        question_hash, question_text, question_embedding, answer_text,
        citations_json, source_material_ids, source_fingerprint, answer_model, ttl_seconds
      ) VALUES (
        ${e.questionHash}, ${e.questionText}, ${literal}::vector, ${e.answerText},
        ${citationsJson}::jsonb, ${idsLiteral}::uuid[], ${e.sourceFingerprint}, ${e.answerModel}, ${ttl}
      )
      ON CONFLICT (question_hash) WHERE invalidated_at IS NULL DO NOTHING
    `),
    mapDatabaseError,
  )
}

/** Soft-invalidates all active cache rows citing the given material. */
export const invalidateAnswersByMaterial = (props: {
  tx: Transaction
  materialId: string
  reason: string
}) =>
  ResultAsync.fromPromise(
    props.tx.execute(sql`
      UPDATE answer_cache SET invalidated_at = now(), invalidated_reason = ${props.reason}
      WHERE invalidated_at IS NULL AND ${props.materialId} = ANY(source_material_ids)
    `),
    mapDatabaseError,
  )

/** Active + total row counts. */
export const answerCacheStats = (props: { tx: Transaction }) =>
  ResultAsync.fromPromise(
    props.tx
      .select({
        active: sql<number>`count(*) FILTER (WHERE ${answerCache.invalidatedAt} IS NULL)::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(answerCache),
    mapDatabaseError,
  ).map((rows) => {
    return { activeRows: rows[0]?.active ?? 0, totalRows: rows[0]?.total ?? 0 }
  })
