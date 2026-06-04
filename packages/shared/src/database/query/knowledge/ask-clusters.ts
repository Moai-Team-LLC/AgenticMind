/**
 * Ask-cluster repository. Persists clusters of
 * semantically-similar /ask questions + their members, and recomputes the
 * promotion aggregate (sum(strength)/sqrt(feedback_count)) in SQL. The
 * nightly builder/promoter drive these. Follows the repo convention:
 * `{ tx }` props, neverthrow ResultAsync, mapDatabaseError.
 */

import type { Transaction } from "@agenticmind/shared/database/client"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { askClusterMembers, askClusters } from "@agenticmind/shared/database/schema"
import {
  MIN_CLUSTER_SIZE,
  MIN_CLUSTER_SIZE_FAST_TRACK,
  PROMOTION_SCORE_THRESHOLD,
} from "@agenticmind/shared/lib/knowledge/clustering"
import { toVectorLiteral } from "@agenticmind/shared/lib/knowledge/vector"
import { desc, eq, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type ClusterRow = {
  id: string
  representativeQ: string
  aggregateScore: number
  memberCount: number
  feedbackCount: number
  state: string
  promotedCardId: string | null
  vetoReason: string | null
  judgeVerdict: string | null
  judgeRationale: string | null
  lastEvaluatedAt: Date | null
  updatedAt: Date
  createdAt: Date
}

const clusterColumns = {
  id: askClusters.id,
  representativeQ: askClusters.representativeQ,
  aggregateScore: askClusters.aggregateScore,
  memberCount: askClusters.memberCount,
  feedbackCount: askClusters.feedbackCount,
  state: askClusters.state,
  promotedCardId: askClusters.promotedCardId,
  vetoReason: askClusters.vetoReason,
  judgeVerdict: askClusters.judgeVerdict,
  judgeRationale: askClusters.judgeRationale,
  lastEvaluatedAt: askClusters.lastEvaluatedAt,
  updatedAt: askClusters.updatedAt,
  createdAt: askClusters.createdAt,
}

/** Closest cluster centroid to the embedding + its cosine similarity, or null when empty. */
export const findNearestCluster = (props: { tx: Transaction; queryEmbedding: number[] }) => {
  if (props.queryEmbedding.length === 0) {
    return ResultAsync.fromSafePromise(
      Promise.resolve<{ cluster: ClusterRow; similarity: number } | null>(null),
    )
  }
  const literal = toVectorLiteral(props.queryEmbedding)
  return ResultAsync.fromPromise(
    props.tx
      .select({
        ...clusterColumns,
        similarity: sql<number>`1 - (${askClusters.centroidEmbedding} <=> ${literal}::vector)`.as(
          "similarity",
        ),
      })
      .from(askClusters)
      .orderBy(sql`${askClusters.centroidEmbedding} <=> ${literal}::vector`)
      .limit(1),
    mapDatabaseError,
  ).map((rows) => {
    const row = rows[0]
    if (row === undefined) {
      return null
    }
    const { similarity, ...cluster } = row
    return { cluster: cluster as ClusterRow, similarity }
  })
}

/** Inserts a new cluster (centroid = the first member's embedding). Returns the id. */
export const createCluster = (props: {
  tx: Transaction
  representativeQ: string
  centroid: number[]
}) =>
  ResultAsync.fromPromise(
    (async (): Promise<string> => {
      const [created] = await props.tx
        .insert(askClusters)
        .values({ representativeQ: props.representativeQ, centroidEmbedding: props.centroid })
        .returning({ id: askClusters.id })
      return created?.id ?? ""
    })(),
    mapDatabaseError,
  )

/** Joins an ask into a cluster (idempotent on the (cluster, ask) pair). */
export const addClusterMember = (props: {
  tx: Transaction
  clusterId: string
  askId: string
  similarity: number
}) =>
  ResultAsync.fromPromise(
    props.tx
      .insert(askClusterMembers)
      .values({ clusterId: props.clusterId, askId: props.askId, similarity: props.similarity })
      .onConflictDoNothing(),
    mapDatabaseError,
  )

/**
 * Recomputes member/feedback counts + aggregate score + state for one cluster
 * in a single SQL pass. Two transitions move open→ready: standard
 * (members ≥ 5 AND score ≥ 0.7) or fast-track (members ≥ 3, all-positive,
 * zero negatives). vetoed/promoted are sticky terminal states.
 */
export const recomputeClusterAggregates = (props: { tx: Transaction; clusterId: string }) =>
  ResultAsync.fromPromise(
    props.tx.execute(sql`
WITH stats AS (
    SELECT
        COUNT(DISTINCT acm.ask_id) AS members,
        COUNT(af.id) AS feedback_n,
        COALESCE(SUM(af.strength), 0)::real AS sum_strength,
        COUNT(*) FILTER (WHERE af.strength > 0) AS positive_n,
        COUNT(*) FILTER (WHERE af.strength < 0) AS negative_n
    FROM ask_cluster_members acm
    LEFT JOIN ask_feedback af ON af.ask_id = acm.ask_id
    WHERE acm.cluster_id = ${props.clusterId}
)
UPDATE ask_clusters c
SET member_count   = stats.members,
    feedback_count = stats.feedback_n,
    aggregate_score = CASE
        WHEN stats.feedback_n = 0 THEN 0
        ELSE stats.sum_strength / sqrt(stats.feedback_n)::real
    END,
    state = CASE
        WHEN c.state IN ('vetoed', 'promoted') THEN c.state
        WHEN stats.members >= ${MIN_CLUSTER_SIZE}
            AND (CASE
                WHEN stats.feedback_n = 0 THEN 0
                ELSE stats.sum_strength / sqrt(stats.feedback_n)::real
            END) >= ${PROMOTION_SCORE_THRESHOLD}
        THEN 'ready'
        WHEN stats.members >= ${MIN_CLUSTER_SIZE_FAST_TRACK}
            AND stats.positive_n > 0
            AND stats.negative_n = 0
        THEN 'ready'
        ELSE 'open'
    END,
    last_evaluated_at = now(),
    updated_at = now()
FROM stats
WHERE c.id = ${props.clusterId}
`),
    mapDatabaseError,
  )

/** Clusters in a given state, highest score first. */
export const listClustersByState = (props: { tx: Transaction; state: string; limit?: number }) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 200 ? props.limit : 50
  return ResultAsync.fromPromise(
    props.tx
      .select(clusterColumns)
      .from(askClusters)
      .where(eq(askClusters.state, props.state))
      .orderBy(desc(askClusters.aggregateScore), desc(askClusters.updatedAt))
      .limit(limit),
    mapDatabaseError,
  )
}

/** Clusters in state=ready, for the promoter's LLM-judge pass. */
export const listReadyClusters = (props: { tx: Transaction; limit?: number }) =>
  listClustersByState({ tx: props.tx, state: "ready", limit: props.limit })

/** Flips state→promoted and records the resulting card id. */
export const markClusterPromoted = (props: {
  tx: Transaction
  clusterId: string
  cardId: string
}) =>
  ResultAsync.fromPromise(
    props.tx
      .update(askClusters)
      .set({ state: "promoted", promotedCardId: props.cardId, updatedAt: sql`now()` })
      .where(eq(askClusters.id, props.clusterId)),
    mapDatabaseError,
  )

/** Flips state→vetoed with a reason (sticky; admin can re-open via SQL). */
export const markClusterVetoed = (props: { tx: Transaction; clusterId: string; reason: string }) =>
  ResultAsync.fromPromise(
    props.tx
      .update(askClusters)
      .set({
        state: "vetoed",
        vetoReason: props.reason.trim() === "" ? null : props.reason,
        updatedAt: sql`now()`,
      })
      .where(eq(askClusters.id, props.clusterId)),
    mapDatabaseError,
  )

/** Records the LLM-judge advisory output on a cluster. */
export const setClusterJudgeVerdict = (props: {
  tx: Transaction
  clusterId: string
  verdict: string
  rationale: string
}) =>
  ResultAsync.fromPromise(
    props.tx
      .update(askClusters)
      .set({
        judgeVerdict: props.verdict.trim() === "" ? null : props.verdict,
        judgeRationale: props.rationale.trim() === "" ? null : props.rationale,
        lastEvaluatedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(askClusters.id, props.clusterId)),
    mapDatabaseError,
  )
