/**
 * Belief repository — bitemporal reads/writes over the `beliefs` table.
 * Convention matches the other knowledge repos: { tx } + ResultAsync.
 *
 * Tiers: actorUuid = <agent> is private memory; actorUuid = null is shared.
 * Writes are belief-revision-aware (a contradicting claim supersedes the old
 * one non-destructively). Reads support "as of" a point in transaction time.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { BeliefInsert, BeliefSelect } from "@agenticmind/shared/database/schema"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { beliefs } from "@agenticmind/shared/database/schema"
import { toVectorLiteral } from "@agenticmind/shared/lib/knowledge/vector"
import { and, desc, eq, gt, isNull, lte, or, type SQL, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type AssertBeliefInput = {
  actorUuid: string | null
  subject: string
  predicate: string
  object: string
  confidence?: number
  sourceKind?: string
  sourceId?: string | null
  embedding?: number[] | null
  validFrom?: Date
}

/**
 * Asserts a belief. With `revise` (default true): if the same actor already
 * holds a CURRENT belief on the same (subject, predicate) with a DIFFERENT
 * object, that belief is superseded (valid_to + invalidated_at set to now), and
 * the new row links back via `supersedes`. Same-object re-assertion just bumps
 * confidence/recency by inserting a fresh current row and retiring the old one.
 * Atomic in one transaction — the graph/trace never see a half-revised state.
 */
export const assertBelief = (props: {
  tx: Transaction
  belief: AssertBeliefInput
  revise?: boolean
}): ResultAsync<BeliefSelect, ReturnType<typeof mapDatabaseError>> => {
  const b = props.belief
  const revise = props.revise ?? true
  return ResultAsync.fromPromise(
    props.tx.transaction(async (tx) => {
      let supersedesId: string | null = null
      if (revise) {
        const actorPred =
          b.actorUuid === null ? isNull(beliefs.actorUuid) : eq(beliefs.actorUuid, b.actorUuid)
        const current = await tx
          .select({ id: beliefs.id, object: beliefs.object })
          .from(beliefs)
          .where(
            and(
              actorPred,
              eq(beliefs.subject, b.subject),
              eq(beliefs.predicate, b.predicate),
              isNull(beliefs.invalidatedAt),
              isNull(beliefs.validTo),
            ),
          )
        for (const row of current) {
          await tx
            .update(beliefs)
            .set({ validTo: sql`now()`, invalidatedAt: sql`now()` })
            .where(eq(beliefs.id, row.id))
          // Link the new belief to the one it directly replaces.
          if (supersedesId === null) supersedesId = row.id
        }
      }

      const values: BeliefInsert = {
        actorUuid: b.actorUuid,
        subject: b.subject,
        predicate: b.predicate,
        object: b.object,
        confidence: b.confidence ?? 0.5,
        sourceKind: b.sourceKind ?? "agent",
        sourceId: b.sourceId ?? null,
        embedding: b.embedding ?? null,
        supersedes: supersedesId,
        validFrom: b.validFrom ?? undefined,
      }
      const [created] = await tx.insert(beliefs).values(values).returning()
      if (created === undefined) throw new Error("assertBelief: insert returned no row")
      return created
    }),
    mapDatabaseError,
  )
}

/** Bitemporal predicate: "still held" now, or held as-of transaction time T. */
const temporalPredicate = (asOf?: Date): SQL => {
  if (asOf === undefined) {
    return and(isNull(beliefs.invalidatedAt), isNull(beliefs.validTo)) as SQL
  }
  return and(
    lte(beliefs.recordedAt, asOf),
    or(isNull(beliefs.invalidatedAt), gt(beliefs.invalidatedAt, asOf)),
    lte(beliefs.validFrom, asOf),
    or(isNull(beliefs.validTo), gt(beliefs.validTo, asOf)),
  ) as SQL
}

const actorPredicate = (actorUuid: string | null, includeShared: boolean): SQL => {
  if (actorUuid === null) return isNull(beliefs.actorUuid) as SQL
  if (includeShared) {
    return or(eq(beliefs.actorUuid, actorUuid), isNull(beliefs.actorUuid)) as SQL
  }
  return eq(beliefs.actorUuid, actorUuid) as SQL
}

/**
 * Recall an actor's beliefs (optionally unioned with shared/collective ones).
 * When `queryEmbedding` is given, orders by vector similarity; otherwise by
 * recency. `asOf` time-travels to what was believed at a past instant.
 */
export const recallBeliefs = (props: {
  tx: Transaction
  actorUuid: string | null
  includeShared?: boolean
  subject?: string
  queryEmbedding?: number[]
  asOf?: Date
  limit?: number
}) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 100 ? props.limit : 20
  const includeShared = props.includeShared ?? true

  const where: SQL[] = [
    actorPredicate(props.actorUuid, includeShared),
    temporalPredicate(props.asOf),
  ]
  if (props.subject !== undefined && props.subject !== "") {
    where.push(eq(beliefs.subject, props.subject))
  }

  const base = {
    id: beliefs.id,
    actorUuid: beliefs.actorUuid,
    subject: beliefs.subject,
    predicate: beliefs.predicate,
    object: beliefs.object,
    confidence: beliefs.confidence,
    sourceKind: beliefs.sourceKind,
    sourceId: beliefs.sourceId,
    validFrom: beliefs.validFrom,
    recordedAt: beliefs.recordedAt,
  }

  if (props.queryEmbedding !== undefined) {
    const literal = toVectorLiteral(props.queryEmbedding)
    return ResultAsync.fromPromise(
      props.tx
        .select({
          ...base,
          score: sql<number>`1 - (${beliefs.embedding} <=> ${literal}::vector)`.as("score"),
        })
        .from(beliefs)
        .where(and(...where, sql`${beliefs.embedding} IS NOT NULL`))
        .orderBy(sql`${beliefs.embedding} <=> ${literal}::vector`)
        .limit(limit),
      mapDatabaseError,
    )
  }

  return ResultAsync.fromPromise(
    props.tx
      .select(base)
      .from(beliefs)
      .where(and(...where))
      .orderBy(desc(beliefs.recordedAt))
      .limit(limit),
    mapDatabaseError,
  )
}

/**
 * All CURRENT beliefs on a (subject, predicate) across actors — the input to
 * conflict detection + consolidation. Caller runs `detectConflicts`.
 */
export const currentBeliefsFor = (props: { tx: Transaction; subject: string; predicate: string }) =>
  ResultAsync.fromPromise(
    props.tx
      .select({
        actorUuid: beliefs.actorUuid,
        subject: beliefs.subject,
        predicate: beliefs.predicate,
        object: beliefs.object,
        confidence: beliefs.confidence,
        recordedAt: beliefs.recordedAt,
      })
      .from(beliefs)
      .where(
        and(
          eq(beliefs.subject, props.subject),
          eq(beliefs.predicate, props.predicate),
          isNull(beliefs.invalidatedAt),
          isNull(beliefs.validTo),
        ),
      ),
    mapDatabaseError,
  )

/** Count of current beliefs held by an actor (null = shared). */
export const countCurrentBeliefs = (props: { tx: Transaction; actorUuid: string | null }) =>
  ResultAsync.fromPromise(
    props.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(beliefs)
      .where(and(actorPredicate(props.actorUuid, false), temporalPredicate())),
    mapDatabaseError,
  ).map((rows) => rows[0]?.count ?? 0)

/**
 * (subject, predicate) pairs that ≥ `minActors` distinct private agents
 * currently hold a belief about — the input to shared-memory consolidation.
 */
export const findConsolidationCandidates = (props: {
  tx: Transaction
  minActors?: number
  limit?: number
}) => {
  const minActors = props.minActors ?? 2
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 1000 ? props.limit : 200
  return ResultAsync.fromPromise(
    (async () => {
      const res = await props.tx.execute(sql`
        SELECT subject, predicate
        FROM beliefs
        WHERE invalidated_at IS NULL AND valid_to IS NULL AND actor_uuid IS NOT NULL
        GROUP BY subject, predicate
        HAVING count(DISTINCT actor_uuid) >= ${minActors}
        LIMIT ${limit}`)
      return res.rows as { subject: string; predicate: string }[]
    })(),
    mapDatabaseError,
  )
}
