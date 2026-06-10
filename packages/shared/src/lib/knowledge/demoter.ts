/**
 * Anti-entrenchment demoter sweep. The promoter is the compounding loop's
 * accelerator; this is its brake. It walks `promoted` clusters whose aggregate
 * feedback score has gone clearly negative and demotes the resolution card they
 * produced to `deprecated` — so a once-popular answer the community later
 * rejected stops surfacing. The card is kept (audit trail intact), not deleted.
 *
 * The promotion side is judge-gated on the way IN; this closes the loop on the
 * way OUT. The decision rule lives in the pure `shouldDemote` (unit-tested); this
 * sweep is the thin DB executor (tsc-checked). Best-effort: a per-card failure
 * is logged and skipped, never aborting the rest of the sweep.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { DemotionCandidate } from "@agenticmind/shared/lib/knowledge/demotion"

import { listDemotablePromotedClusters } from "@agenticmind/shared/database/query/knowledge/ask-clusters"
import { demoteCard } from "@agenticmind/shared/database/query/knowledge/cards"
import { isCardStatus } from "@agenticmind/shared/lib/knowledge/card"
import {
  DEMOTION_MIN_FEEDBACK,
  DEMOTION_SCORE_THRESHOLD,
} from "@agenticmind/shared/lib/knowledge/clustering"
import { demotionReason, shouldDemote } from "@agenticmind/shared/lib/knowledge/demotion"
import { ResultAsync } from "neverthrow"

export type DemoterError = { readonly type: "demoter_error"; readonly message: string }
const demoterError = (message: string): DemoterError => {
  return { type: "demoter_error", message }
}

export type DemoteResult = { scanned: number; demoted: number; skipped: number }

/**
 * One demotion pass. Candidates are pre-filtered in SQL (promoted + below the
 * score floor + enough feedback); the pure `shouldDemote` is re-applied per row
 * as the canonical gate (it also skips cards already non-retrievable). Bounded
 * by `maxPerSweep` so a backlog drains over several nightly runs.
 */
export const sweepDemoteCards = (props: {
  tx: Transaction
  scoreThreshold?: number
  minFeedback?: number
  maxPerSweep?: number
}): ResultAsync<DemoteResult, DemoterError> => {
  const scoreThreshold = props.scoreThreshold ?? DEMOTION_SCORE_THRESHOLD
  const minFeedback = props.minFeedback ?? DEMOTION_MIN_FEEDBACK
  const maxPerSweep =
    props.maxPerSweep !== undefined && props.maxPerSweep > 0 && props.maxPerSweep <= 200
      ? props.maxPerSweep
      : 50

  return ResultAsync.fromPromise(
    (async (): Promise<DemoteResult> => {
      const candidatesResult = await listDemotablePromotedClusters({
        tx: props.tx,
        scoreThreshold,
        minFeedback,
        limit: maxPerSweep,
      })
      if (candidatesResult.isErr()) {
        throw new Error(candidatesResult.error.message)
      }
      const candidates = candidatesResult.value

      let demoted = 0
      let skipped = 0
      for (const row of candidates) {
        if (row.cardId === null || !isCardStatus(row.cardStatus)) {
          skipped++
          continue
        }
        const candidate: DemotionCandidate = {
          clusterId: row.clusterId,
          cardId: row.cardId,
          state: row.state,
          aggregateScore: row.aggregateScore,
          feedbackCount: row.feedbackCount,
          cardStatus: row.cardStatus,
        }
        if (!shouldDemote(candidate, { scoreThreshold, minFeedback })) {
          skipped++
          continue
        }
        const result = await demoteCard({
          tx: props.tx,
          cardId: candidate.cardId,
          reason: demotionReason(candidate),
        })
        if (result.isErr()) {
          skipped++
          continue
        }
        demoted += result.value
      }

      return { scanned: candidates.length, demoted, skipped }
    })(),
    (e) => demoterError(e instanceof Error ? e.message : String(e)),
  )
}
