import type { Transaction } from "@agenticmind/shared/database/client"

import { sweepConsolidateBeliefs } from "@agenticmind/shared/lib/knowledge/belief-consolidator"
import { sweepFeedbackClusters } from "@agenticmind/shared/lib/knowledge/feedback-builder"
import { sweepPromoteClusters } from "@agenticmind/shared/lib/knowledge/feedback-promoter"

// Re-scan window: each run reconsiders the last 7 days of asks. The builder only
// Touches un-clustered rows and AddMember is idempotent, so re-scanning is cheap
// And self-healing across restarts.
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Tier-4 feedback loop:
 *   1. builder — group recent asks into clusters by question-embedding cosine.
 *   2. promoter — LLM-judge ready clusters, promote `supported` ones to
 *      kind=resolution knowledge cards.
 * Both steps are best-effort and log their counts; a failure in one never
 * aborts the sweep (the next run retries).
 */
export const runKnowledgeFeedbackSweep = async (db: Transaction): Promise<void> => {
  const at = new Date().toISOString()
  console.log(`[WORKER] ${at}: knowledge feedback sweep starting`)

  const since = new Date(Date.now() - LOOKBACK_MS)
  const built = await sweepFeedbackClusters({ tx: db, since })
  built.match(
    (r) => {
      console.log(
        `[KNOWLEDGE_FEEDBACK] builder: scanned=${r.scanned} joined=${r.joined} new=${r.newClusters}`,
      )
    },
    (e) => {
      console.error(`[KNOWLEDGE_FEEDBACK] builder failed:`, e)
    },
  )

  const promoted = await sweepPromoteClusters({ tx: db })
  promoted.match(
    (r) => {
      console.log(
        `[KNOWLEDGE_FEEDBACK] promoter: promoted=${r.promoted} judged=${r.judged} skipped=${r.skipped}`,
      )
    },
    (e) => {
      console.error(`[KNOWLEDGE_FEEDBACK] promoter failed:`, e)
    },
  )

  // Memory consolidation: corroborated private beliefs → shared/collective memory.
  const consolidated = await sweepConsolidateBeliefs({ tx: db })
  consolidated.match(
    (r) => {
      console.log(`[BELIEF] consolidate: scanned=${r.scanned} consolidated=${r.consolidated}`)
    },
    () => {
      // Consolidation is best-effort; failures are non-fatal and already logged upstream.
    },
  )
}
