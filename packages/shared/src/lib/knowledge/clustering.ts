/**
 * Ask-clustering thresholds + pure helpers. The cluster repo (SQL)
 * and the nightly builder/promoter import these. Kept env-free so they
 * unit-test in isolation.
 */

/**
 * Membership floor for the standard promotion path. Below this we don't have
 * enough samples to trust the aggregate score — one member's "thumb up" can't
 * drive a public answer card by itself.
 */
export const MIN_CLUSTER_SIZE = 5

/**
 * Fast-track floor (Tier 3.2 compounding loop): a cluster with at least this
 * many members AND only positive signals reaches "ready" early so the
 * LLM-judge runs sooner. The judge stays the final gate, so a strong but
 * hallucinated answer is still caught — this only changes how fast the
 * cluster reaches the gate.
 */
export const MIN_CLUSTER_SIZE_FAST_TRACK = 3

/**
 * Aggregate-score threshold to move a cluster from "open" to "ready".
 * Formula: aggregate_score = sum(strength) / sqrt(feedback_count) — sqrt
 * normalisation rewards both volume and direction without letting one
 * outlier monopolise. 0.7 ≈ "majority positive AND some strong signals".
 */
export const PROMOTION_SCORE_THRESHOLD = 0.7

/**
 * Cosine cutoff for joining an existing cluster vs creating a new one. 0.85 =
 * "very similar phrasing" — groups "what is YC?" with "what is Y Combinator?",
 * but not "open a Ireland company" with "tax residency in Ireland".
 */
export const CLUSTER_MATCH_THRESHOLD = 0.85

/**
 * Aggregate-score floor below which a *promoted* cluster's resolution card is
 * demoted (anti-entrenchment). A card is born from a `supported` judge verdict,
 * but feedback keeps flowing into its cluster after promotion; if the community
 * later turns against the answer the score goes negative (sum(strength) is
 * negative). −0.7 mirrors the promotion threshold's magnitude: "majority
 * negative AND some strong signals" — a symmetric, deliberately conservative
 * bar so a couple of stray downvotes can't retract a good card.
 */
export const DEMOTION_SCORE_THRESHOLD = -0.7

/**
 * Minimum feedback events on a promoted cluster before demotion is even
 * considered. Without a floor, one or two late negatives could retract a card
 * promoted on strong earlier consensus. Matches the standard membership floor.
 */
export const DEMOTION_MIN_FEEDBACK = 5

/** Whether an ask with the given centroid cosine should join the nearest cluster. */
export const shouldJoinCluster = (similarity: number): boolean =>
  similarity >= CLUSTER_MATCH_THRESHOLD
