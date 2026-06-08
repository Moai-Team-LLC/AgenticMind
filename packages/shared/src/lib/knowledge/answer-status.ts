/**
 * Answer status — the single trust verdict an agent gates on. The engine already
 * emits granular faithfulness signals (Tier-A `groundedness` + `unsupportedClaims`,
 * Tier-B `semanticGroundedness` + `contradictedClaims`, `contested` sources,
 * `abstained`); this collapses them into one field so a caller doesn't have to
 * re-derive the policy:
 *
 *   supported     — every claim is cited AND (when checked) entailed by its source
 *   partial       — some claims are grounded, some are not
 *   unsupported   — the answer declined, or almost nothing is grounded
 *   conflicted    — retrieved sources directly disagree on a fact
 *   needs_review  — a cited claim is NOT entailed by its own snippet (the
 *                   "confident but wrong" trap) — a human should look
 *
 * Pure: derived only from the signals already on the Answer, no extra work. The
 * embodiment of the product promise — "No source, no claim. No trace, no trust."
 */

export const ANSWER_STATUSES = [
  "supported",
  "partial",
  "unsupported",
  "conflicted",
  "needs_review",
] as const
export type AnswerStatus = (typeof ANSWER_STATUSES)[number]

/** The Answer signals the verdict is derived from (all optional — engine-version safe). */
export type AnswerStatusSignals = {
  groundedness?: number
  semanticGroundedness?: number
  contradictedClaims?: readonly string[]
  contested?: readonly unknown[]
  abstained?: boolean
}

/** Groundedness at/above this (≈ every claim cited) is eligible for "supported". */
export const SUPPORTED_GROUNDEDNESS = 0.999
/** Below this, too little is grounded to call the answer even "partial". */
export const PARTIAL_GROUNDEDNESS = 0.5
/** When Tier-B ran, semantic groundedness must clear this for "supported". */
export const SEMANTIC_SUPPORT_FLOOR = 0.8

/**
 * Collapses the faithfulness signals into one verdict. Precedence is by severity:
 * an honest decline and a source conflict are decided before the grounded/partial
 * gradient, and a cited-but-unentailed claim always escalates to review.
 */
export const deriveAnswerStatus = (signals: AnswerStatusSignals): AnswerStatus => {
  if (signals.abstained === true) {
    return "unsupported"
  }
  if ((signals.contested?.length ?? 0) > 0) {
    return "conflicted"
  }
  // Cited but the snippet doesn't actually support it — the most dangerous case.
  if ((signals.contradictedClaims?.length ?? 0) > 0) {
    return "needs_review"
  }
  const grounded = signals.groundedness ?? 1
  const semantic = signals.semanticGroundedness
  const semanticOk = semantic === undefined || semantic >= SEMANTIC_SUPPORT_FLOOR
  if (grounded >= SUPPORTED_GROUNDEDNESS && semanticOk) {
    return "supported"
  }
  if (grounded >= PARTIAL_GROUNDEDNESS) {
    return "partial"
  }
  return "unsupported"
}
