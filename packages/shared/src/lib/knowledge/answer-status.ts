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
  /** Every cited source is non-active (deprecated/superseded/archived) — the
   * answer rests only on stale knowledge. Escalates to needs_review. */
  staleSourcesOnly?: boolean
  /** Substantial numeric figures asserted in the answer but absent from every
   * cited snippet (deterministic Tier-A numeric check) — escalates to needs_review. */
  ungroundedFigures?: readonly string[]
  /** Cited claims whose own snippet shares no salient content word — a likely
   * mis-attributed (decorative/wrong) citation. Escalates to needs_review. */
  weaklyAttributedClaims?: readonly string[]
  /** Quoted phrases presented as direct quotations but absent verbatim from every
   * cited snippet (deterministic Tier-A quote check) — escalates to needs_review. */
  ungroundedQuotes?: readonly string[]
}

/** Lifecycle states that are NOT current — a citation in one of these is stale. */
const STALE_LIFECYCLES = new Set<string>(["deprecated", "superseded", "archived"])

/**
 * True when the answer cites at least one source and EVERY cited source is in a
 * non-active lifecycle state — i.e. it rests only on stale knowledge. A citation
 * with unknown lifecycle counts as current (not stale), so this never false-flags.
 */
export const restsOnlyOnStaleSources = (citations: readonly { lifecycle?: string }[]): boolean =>
  citations.length > 0 &&
  citations.every((c) => c.lifecycle !== undefined && STALE_LIFECYCLES.has(c.lifecycle))

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
  // Or: the answer rests only on stale (non-active) sources. Either way, escalate.
  if (
    (signals.contradictedClaims?.length ?? 0) > 0 ||
    signals.staleSourcesOnly === true ||
    (signals.ungroundedFigures?.length ?? 0) > 0 ||
    (signals.weaklyAttributedClaims?.length ?? 0) > 0 ||
    (signals.ungroundedQuotes?.length ?? 0) > 0
  ) {
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
