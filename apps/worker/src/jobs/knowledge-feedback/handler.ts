import type { Transaction } from "@agenticmind/shared/database/client"

import { sweepConsolidateBeliefs } from "@agenticmind/shared/lib/knowledge/belief-consolidator"
import { sweepFeedbackClusters } from "@agenticmind/shared/lib/knowledge/feedback-builder"
import { sweepPromoteClusters } from "@agenticmind/shared/lib/knowledge/feedback-promoter"
import { SpanKind, withSpan } from "@agenticmind/shared/lib/observability/trace"

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
export const runKnowledgeFeedbackSweep = (db: Transaction): Promise<void> =>
  // Trace the compounding loop (a no-op until the worker registers an exporter)
  // so the self-improving path is observable alongside the read path.
  withSpan("knowledge.feedback_sweep", SpanKind.CHAIN, async (span) => {
    const at = new Date().toISOString()
    console.log(`[WORKER] ${at}: knowledge feedback sweep starting`)

    const since = new Date(Date.now() - LOOKBACK_MS)
    const built = await sweepFeedbackClusters({ tx: db, since })
    built.match(
      (r) => {
        span.setAttribute("feedback.clusters_new", r.newClusters)
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
        span.setAttribute("feedback.promoted", r.promoted)
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
        span.setAttribute("belief.consolidated", r.consolidated)
        console.log(`[BELIEF] consolidate: scanned=${r.scanned} consolidated=${r.consolidated}`)
      },
      () => {
        // Consolidation is best-effort; failures are non-fatal and already logged upstream.
      },
    )
  })
