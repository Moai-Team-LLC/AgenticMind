/**
 * Knowledge cards repository. Vector + BM25 retrieval (with
 * kind/subject_type/confidence filters), a deterministic structured Filter
 * (Tier-2), upsert, and the re-extraction backlog queries. Follows the repo's
 * { tx } + ResultAsync convention.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { CardKind } from "@agenticmind/shared/lib/knowledge/card"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import {
  buildFtsWhereClause,
  dedupeVariants,
} from "@agenticmind/shared/database/query/knowledge/chunks"
import { knowledgeCards, materials } from "@agenticmind/shared/database/schema"
import { toVectorLiteral } from "@agenticmind/shared/lib/knowledge/vector"
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, notExists, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type CardHit = {
  cardId: string
  materialId: string
  kind: string
  subjectType: string
  subjectValue: string
  predicate: string
  body: string
  confidence: number
  score: number
  spanStart: number | null
  spanEnd: number | null
}

export type CardInput = {
  kind: CardKind
  subjectType: string
  subjectValue: string
  predicate?: string | null
  value?: string | null
  body: string
  question?: string | null
  spanStart?: number | null
  spanEnd?: number | null
  confidence: number
  validFrom?: Date | null
  validTo?: Date | null
  embedding?: number[] | null
  embeddingModel?: string | null
  extractorVersion?: string | null
}

const emptyToNull = (v: string | null | undefined): string | null =>
  v === undefined || v === "" ? null : v

const hitColumns = {
  cardId: knowledgeCards.id,
  materialId: knowledgeCards.materialId,
  kind: knowledgeCards.kind,
  subjectType: knowledgeCards.subjectType,
  subjectValue: knowledgeCards.subjectValue,
  predicate: knowledgeCards.predicate,
  body: knowledgeCards.body,
  confidence: knowledgeCards.confidence,
  spanStart: knowledgeCards.spanStart,
  spanEnd: knowledgeCards.spanEnd,
}

type RawCardRow = {
  cardId: string
  materialId: string
  kind: string
  subjectType: string
  subjectValue: string
  predicate: string | null
  body: string
  confidence: number
  spanStart: number | null
  spanEnd: number | null
  score: number
}

const toCardHit = (r: RawCardRow): CardHit => {
  return { ...r, predicate: r.predicate ?? "" }
}

/** Atomically replaces a material's cards (delete + insert). Pass a tx for atomicity. */
export const upsertCards = (props: {
  tx: Transaction
  materialId: string
  items: CardInput[]
  ftsConfig?: string
}) =>
  ResultAsync.fromPromise(
    (async () => {
      await props.tx.delete(knowledgeCards).where(eq(knowledgeCards.materialId, props.materialId))
      const config = props.ftsConfig ?? "simple"
      if (props.items.length > 0) {
        await props.tx.insert(knowledgeCards).values(
          props.items.map((c) => {
            return {
              materialId: props.materialId,
              kind: c.kind,
              subjectType: c.subjectType,
              subjectValue: c.subjectValue,
              predicate: emptyToNull(c.predicate),
              value: emptyToNull(c.value),
              body: c.body,
              question: emptyToNull(c.question),
              spanStart: c.spanStart ?? null,
              spanEnd: c.spanEnd ?? null,
              confidence: c.confidence,
              validFrom: c.validFrom ?? null,
              validTo: c.validTo ?? null,
              embedding:
                c.embedding !== undefined && c.embedding !== null && c.embedding.length > 0
                  ? c.embedding
                  : null,
              embeddingModel: emptyToNull(c.embeddingModel),
              extractorVersion: emptyToNull(c.extractorVersion),
              ftsConfig: config,
              bodyTsv: sql`to_tsvector(${config}::regconfig, coalesce(${c.body}, ''))`,
            }
          }),
        )
      }
    })(),
    mapDatabaseError,
  )

export const deleteCardsByMaterial = (props: { tx: Transaction; materialId: string }) =>
  ResultAsync.fromPromise(
    props.tx.delete(knowledgeCards).where(eq(knowledgeCards.materialId, props.materialId)),
    mapDatabaseError,
  )

export const countCardsByMaterial = (props: { tx: Transaction; materialId: string }) =>
  ResultAsync.fromPromise(
    props.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeCards)
      .where(eq(knowledgeCards.materialId, props.materialId)),
    mapDatabaseError,
  ).map((rows) => rows[0]?.count ?? 0)

/** Lists a material's cards (embeddings omitted), ordered by (kind, confidence desc). */
export const listCardsByMaterial = (props: {
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
        id: knowledgeCards.id,
        materialId: knowledgeCards.materialId,
        kind: knowledgeCards.kind,
        subjectType: knowledgeCards.subjectType,
        subjectValue: knowledgeCards.subjectValue,
        predicate: knowledgeCards.predicate,
        value: knowledgeCards.value,
        body: knowledgeCards.body,
        question: knowledgeCards.question,
        spanStart: knowledgeCards.spanStart,
        spanEnd: knowledgeCards.spanEnd,
        confidence: knowledgeCards.confidence,
        validFrom: knowledgeCards.validFrom,
        validTo: knowledgeCards.validTo,
        embeddingModel: knowledgeCards.embeddingModel,
        extractorVersion: knowledgeCards.extractorVersion,
        createdAt: knowledgeCards.createdAt,
      })
      .from(knowledgeCards)
      .where(eq(knowledgeCards.materialId, props.materialId))
      .orderBy(asc(knowledgeCards.kind), desc(knowledgeCards.confidence))
      .limit(limit)
      .offset(offset),
    mapDatabaseError,
  )
}

type RetrievalFilters = {
  minConfidence?: number
  kinds?: string[]
  subjectTypes?: string[]
}

const retrievalConditions = (f: RetrievalFilters) => [
  gte(knowledgeCards.confidence, f.minConfidence ?? 0),
  f.kinds !== undefined && f.kinds.length > 0 ? inArray(knowledgeCards.kind, f.kinds) : undefined,
  f.subjectTypes !== undefined && f.subjectTypes.length > 0
    ? inArray(knowledgeCards.subjectType, f.subjectTypes)
    : undefined,
]

/** Vector nearest-neighbour search with optional kind/subject/confidence filters. */
export const searchCards = (
  props: {
    tx: Transaction
    queryEmbedding: number[]
    limit?: number
    offset?: number
  } & RetrievalFilters,
) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 100 ? props.limit : 10
  const offset = props.offset !== undefined && props.offset >= 0 ? props.offset : 0
  const literal = toVectorLiteral(props.queryEmbedding)
  return ResultAsync.fromPromise(
    props.tx
      .select({
        ...hitColumns,
        score: sql<number>`1 - (${knowledgeCards.embedding} <=> ${literal}::vector)`.as("score"),
      })
      .from(knowledgeCards)
      .where(and(isNotNull(knowledgeCards.embedding), ...retrievalConditions(props)))
      .orderBy(sql`${knowledgeCards.embedding} <=> ${literal}::vector`)
      .limit(limit)
      .offset(offset),
    mapDatabaseError,
  ).map((rows) => rows.map((r) => toCardHit(r)))
}

/** BM25 search over the body_tsv with the same filters as searchCards. */
export const searchCardsBm25 = (
  props: {
    tx: Transaction
    query: string
    variants?: string[]
    limit?: number
  } & RetrievalFilters,
) => {
  const variants = dedupeVariants(props.query, props.variants)
  if (variants.length === 0) {
    return ResultAsync.fromSafePromise(Promise.resolve<CardHit[]>([]))
  }
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 100 ? props.limit : 10

  const whereClause = buildFtsWhereClause(knowledgeCards, variants)

  const tsQueryParts = variants.map(
    (v) => sql`plainto_tsquery(${knowledgeCards.ftsConfig}::regconfig, ${v})`,
  )
  const tsQuery = sql`(${sql.join(tsQueryParts, sql` || `)})`

  return ResultAsync.fromPromise(
    props.tx
      .select({
        ...hitColumns,
        score: sql<number>`ts_rank_cd(${knowledgeCards.bodyTsv}, ${tsQuery})`.as("score"),
      })
      .from(knowledgeCards)
      .where(and(whereClause, ...retrievalConditions(props)))
      .orderBy(sql`ts_rank_cd(${knowledgeCards.bodyTsv}, ${tsQuery}) DESC`)
      .limit(limit),
    mapDatabaseError,
  ).map((rows) => rows.map((r) => toCardHit(r)))
}

export type CardFilter = {
  subjectType?: string
  subjectValueLike?: string
  predicate?: string
  kinds?: string[]
  minConfidence?: number
  materialId?: string
  limit?: number
  offset?: number
}

/**
 * Deterministic structured retrieval (Tier-2): pure SQL filter, no embedding
 * or tsquery. Returns hits (score = confidence) sorted by confidence desc then
 * created_at desc, plus the total count for the same filter (for pagination).
 */
export const filterCards = (props: { tx: Transaction } & CardFilter) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 200 ? props.limit : 50
  const offset = props.offset !== undefined && props.offset >= 0 ? props.offset : 0
  const conditions = [
    props.subjectType !== undefined && props.subjectType !== ""
      ? eq(knowledgeCards.subjectType, props.subjectType)
      : undefined,
    props.subjectValueLike !== undefined && props.subjectValueLike !== ""
      ? ilike(knowledgeCards.subjectValue, `%${props.subjectValueLike}%`)
      : undefined,
    props.predicate !== undefined && props.predicate !== ""
      ? eq(knowledgeCards.predicate, props.predicate)
      : undefined,
    props.kinds !== undefined && props.kinds.length > 0
      ? inArray(knowledgeCards.kind, props.kinds)
      : undefined,
    props.minConfidence !== undefined && props.minConfidence > 0
      ? gte(knowledgeCards.confidence, props.minConfidence)
      : undefined,
    props.materialId !== undefined && props.materialId !== ""
      ? eq(knowledgeCards.materialId, props.materialId)
      : undefined,
  ]
  const whereClause = and(...conditions)

  return ResultAsync.combine([
    ResultAsync.fromPromise(
      props.tx
        .select({ count: sql<number>`count(*)::int` })
        .from(knowledgeCards)
        .where(whereClause),
      mapDatabaseError,
    ),
    ResultAsync.fromPromise(
      props.tx
        .select({ ...hitColumns, score: sql<number>`${knowledgeCards.confidence}`.as("score") })
        .from(knowledgeCards)
        .where(whereClause)
        .orderBy(desc(knowledgeCards.confidence), desc(knowledgeCards.createdAt))
        .limit(limit)
        .offset(offset),
      mapDatabaseError,
    ),
  ]).map(([countRows, rows]) => {
    return {
      total: countRows[0]?.count ?? 0,
      hits: rows.map((r) => toCardHit(r)),
    }
  })
}

/** Up to `limit` materials with zero cards (re-extraction backlog). */
export const materialIdsWithoutCards = (props: { tx: Transaction; limit?: number }) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 200 ? props.limit : 10
  return ResultAsync.fromPromise(
    props.tx
      .select({ id: materials.id })
      .from(materials)
      .where(
        notExists(
          props.tx
            .select({ one: sql`1` })
            .from(knowledgeCards)
            .where(eq(knowledgeCards.materialId, materials.id)),
        ),
      )
      .orderBy(desc(materials.createdAt))
      .limit(limit),
    mapDatabaseError,
  ).map((rows) => rows.map((r) => r.id))
}

/** Up to `limit` distinct materials with cards whose extractor_version differs. */
export const materialIdsWithStaleCards = (props: {
  tx: Transaction
  currentVersion: string
  limit?: number
}) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 200 ? props.limit : 10
  return ResultAsync.fromPromise(
    props.tx
      .selectDistinct({ materialId: knowledgeCards.materialId })
      .from(knowledgeCards)
      .where(sql`${knowledgeCards.extractorVersion} IS DISTINCT FROM ${props.currentVersion}`)
      .limit(limit),
    mapDatabaseError,
  ).map((rows) => rows.map((r) => r.materialId))
}
