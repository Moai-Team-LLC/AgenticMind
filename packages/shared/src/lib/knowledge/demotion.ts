/**
 * Anti-entrenchment demotion — the pure decision layer. The compounding loop
 * promotes a popular, judge-approved answer into a `resolution` knowledge card.
 * But promotion is sticky and feedback keeps flowing: a card the community later
 * turns against would otherwise stay retrievable forever ("popular-but-wrong
 * entrenchment"). This module decides — with no DB or LLM — whether a given
 * promoted cluster's card has earned demotion, so the rule is unit-testable in
 * isolation and the SQL sweep stays a thin executor over it.
 *
 * Demotion is conservative by construction: it requires a sticky `promoted`
 * cluster, a live (still-retrievable) card, ENOUGH feedback, and a clearly
 * negative aggregate score. Demotion moves the card to `deprecated` (a
 * non-retrievable status) rather than deleting it — the why-trace and audit
 * trail are preserved; the card simply stops surfacing.
 */

import type { CardStatus } from "@agenticmind/shared/lib/knowledge/card"

import { NON_RETRIEVABLE_CARD_STATUSES } from "@agenticmind/shared/lib/knowledge/card"
import {
  DEMOTION_MIN_FEEDBACK,
  DEMOTION_SCORE_THRESHOLD,
} from "@agenticmind/shared/lib/knowledge/clustering"

/** A promoted cluster + the current status of the card it produced. */
export type DemotionCandidate = {
  clusterId: string
  cardId: string
  /** Sticky cluster state — only `promoted` clusters own a card to demote. */
  state: string
  aggregateScore: number
  feedbackCount: number
  /** Current status of the promoted card (it may already be non-retrievable). */
  cardStatus: CardStatus
}

/** Tunable bars; defaults come from the clustering thresholds. */
export type DemotionThresholds = {
  scoreThreshold?: number
  minFeedback?: number
}

/**
 * Should this promoted card be demoted? True iff:
 *  - the cluster is in the sticky `promoted` state (it actually owns a card),
 *  - the card is still retrievable (demoting an already-dead card is a no-op),
 *  - it has accrued at least `minFeedback` signals (enough evidence to act), and
 *  - its aggregate score has fallen to or below the (negative) demotion floor.
 * Pure — no I/O — so the entrenchment rule is verifiable by table-test.
 */
export const shouldDemote = (
  candidate: DemotionCandidate,
  thresholds: DemotionThresholds = {},
): boolean => {
  const scoreThreshold = thresholds.scoreThreshold ?? DEMOTION_SCORE_THRESHOLD
  const minFeedback = thresholds.minFeedback ?? DEMOTION_MIN_FEEDBACK
  if (candidate.state !== "promoted") {
    return false
  }
  if (NON_RETRIEVABLE_CARD_STATUSES.includes(candidate.cardStatus)) {
    return false
  }
  if (candidate.feedbackCount < minFeedback) {
    return false
  }
  return candidate.aggregateScore <= scoreThreshold
}

/** Human-readable demotion reason, recorded on the card's confidence_reason. */
export const demotionReason = (candidate: DemotionCandidate): string =>
  `auto-demoted: promoted cluster aggregate_score ${candidate.aggregateScore.toFixed(2)} ` +
  `≤ floor over ${candidate.feedbackCount} feedback events (anti-entrenchment)`
