/**
 * Feedback cluster builder. Groups recent /ask rows
 * into clusters by question-embedding cosine: scans ask_telemetry rows not yet
 * clustered, recovers each question's embedding from answer_cache (or
 * re-embeds the cached text), joins the nearest cluster (cosine ≥ 0.85) or
 * starts a new one, then recomputes the touched clusters' aggregates so the
 * promoter sees fresh scores. DB + embed coupled; the join decision
 * (shouldJoinCluster) and thresholds are unit-tested in clustering.ts.
 */

import type { Transaction } from "@agenticmind/shared/database/client"

import {
  addClusterMember,
  createCluster,
  findNearestCluster,
  recomputeClusterAggregates,
} from "@agenticmind/shared/database/query/knowledge/ask-clusters"
import { answerCache, askClusterMembers, askTelemetry } from "@agenticmind/shared/database/schema"
import { shouldJoinCluster } from "@agenticmind/shared/lib/knowledge/clustering"
import { embedKnowledgeText } from "@agenticmind/shared/lib/knowledge/llm"
import { and, asc, eq, gt, isNull } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type BuilderError = { readonly type: "builder_error"; readonly message: string }
const builderError = (message: string): BuilderError => {
  return { type: "builder_error", message }
}

export type SweepResult = {
  scanned: number
  joined: number
  newClusters: number
  /** Newest created_at processed — caller persists it as the next high-water. */
  maxSeen: Date
}

/** Injectable embedder (defaults to the live knowledge embedder). */
export type EmbedFn = (text: string) => ResultAsync<number[], { message: string }>

/**
 * One clustering sweep over asks created after `since`. Per-ask failures are
 * logged + skipped (one bad row shouldn't lose the batch). Returns counts +
 * the high-water to carry into the next run.
 */
export const sweepFeedbackClusters = (props: {
  tx: Transaction
  since: Date
  batchLimit?: number
  embed?: EmbedFn
}): ResultAsync<SweepResult, BuilderError> => {
  const batch =
    props.batchLimit !== undefined && props.batchLimit > 0 && props.batchLimit <= 1000
      ? props.batchLimit
      : 200
  const embed = props.embed ?? ((text: string) => embedKnowledgeText(text))

  return ResultAsync.fromPromise(
    (async (): Promise<SweepResult> => {
      const rows = await props.tx
        .select({
          askId: askTelemetry.id,
          createdAt: askTelemetry.createdAt,
          questionText: answerCache.questionText,
          questionEmbedding: answerCache.questionEmbedding,
        })
        .from(askTelemetry)
        .leftJoin(
          answerCache,
          and(
            eq(answerCache.questionHash, askTelemetry.questionHash),
            isNull(answerCache.invalidatedAt),
          ),
        )
        .leftJoin(askClusterMembers, eq(askClusterMembers.askId, askTelemetry.id))
        .where(and(gt(askTelemetry.createdAt, props.since), isNull(askClusterMembers.askId)))
        .orderBy(asc(askTelemetry.createdAt))
        .limit(batch)

      let scanned = 0
      let joined = 0
      let newClusters = 0
      let maxSeen = props.since
      const touched = new Set<string>()
      const seenAsk = new Set<string>()

      for (const row of rows) {
        // The cache LEFT JOIN can duplicate a telemetry row if >1 active cache
        // Entry shares a hash — process each ask once.
        if (seenAsk.has(row.askId)) {
          continue
        }
        seenAsk.add(row.askId)
        scanned++
        if (row.createdAt.getTime() > maxSeen.getTime()) {
          maxSeen = row.createdAt
        }

        let emb = row.questionEmbedding ?? []
        const text = row.questionText ?? ""
        if (emb.length === 0 && text !== "") {
          const embedded = await embed(text)
          if (embedded.isErr()) {
            console.warn(`[Knowledge] builder: embed ${row.askId} failed`, embedded.error)
            continue
          }
          emb = embedded.value
        }
        if (emb.length === 0) {
          continue
        } // No vector + no recoverable text → can't cluster

        const nearest = await findNearestCluster({ tx: props.tx, queryEmbedding: emb })
        if (nearest.isErr()) {
          console.warn(`[Knowledge] builder: nearest ${row.askId} failed`, nearest.error)
          continue
        }

        let clusterId: string
        let similarity: number
        if (nearest.value !== null && shouldJoinCluster(nearest.value.similarity)) {
          clusterId = nearest.value.cluster.id
          similarity = nearest.value.similarity
          joined++
        } else {
          const created = await createCluster({
            tx: props.tx,
            representativeQ: text !== "" ? text : "(question text unavailable)",
            centroid: emb,
          })
          if (created.isErr() || created.value === "") {
            console.warn(`[Knowledge] builder: create cluster for ${row.askId} failed`)
            continue
          }
          clusterId = created.value
          similarity = 1
          newClusters++
        }

        const added = await addClusterMember({
          tx: props.tx,
          clusterId,
          askId: row.askId,
          similarity,
        })
        if (added.isErr()) {
          console.warn(`[Knowledge] builder: add member ${row.askId} failed`, added.error)
          continue
        }
        touched.add(clusterId)
      }

      for (const clusterId of touched) {
        const recomputed = await recomputeClusterAggregates({ tx: props.tx, clusterId })
        if (recomputed.isErr()) {
          console.warn(`[Knowledge] builder: recompute ${clusterId} failed`, recomputed.error)
        }
      }

      return { scanned, joined, newClusters, maxSeen }
    })(),
    (e) => builderError(e instanceof Error ? e.message : String(e)),
  )
}
