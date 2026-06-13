/**
 * Pipeline diagnostics — the pure half. Given the signals an answer already
 * carries (status, servedBy, groundedness, contested, …), classify what most
 * likely went wrong and which knob addresses it. This codifies the
 * symptom→signal→stage→knob runbook (OPERATIONS.md §6) as a deterministic,
 * unit-tested function so failure localisation is automated, not eyeballed.
 *
 * No I/O: `scripts/diagnose.ts` runs a question through `ask`, maps the resulting
 * Answer into `AnswerSignals`, and feeds it here. The same fields are on the
 * OTLP why-trace, so this also classifies a replayed production answer.
 */

/** The subset of an answer's why-trace this classifier reasons over. */
export type AnswerSignals = {
  /** supported | partial | unsupported | conflicted | needs_review */
  status?: string
  /** cache | card_synth | synth — which path produced the answer */
  servedBy?: string
  groundedness?: number
  semanticGroundedness?: number
  abstained?: boolean
  citationsCount?: number
  contestedCount?: number
  contradictedClaims?: number
  unsupportedClaims?: number
  staleSourcesOnly?: boolean
  rerankUsed?: boolean
  /** per-stage timings (ms) from the trace */
  phases?: { phase: string; ms: number }[]
}

export type Severity = "high" | "medium" | "info"

export type Diagnosis = {
  /** Pipeline stage to look at first. */
  stage: string
  /** What the signals indicate. */
  cause: string
  /** The lever to pull (env knob, data fix, or caller action). */
  knob: string
  severity: Severity
}

const GROUNDEDNESS_FLOOR = 0.5
const SLOW_PHASE_MS = 4000

/**
 * Classify an answer's signals into ordered diagnoses (most actionable first).
 * Pure + deterministic. An empty array means "no anomaly the signals can localise"
 * — for a suspected-wrong answer that still looks healthy, the fault is usually the
 * SOURCE/corpus, surfaced by the trailing info diagnosis.
 */
export const classifyAnswer = (signals: AnswerSignals): Diagnosis[] => {
  const out: Diagnosis[] = []
  const cites = signals.citationsCount ?? 0
  const grounded = signals.groundedness ?? 1

  // Served from cache: the answer didn't go through fresh retrieval/synthesis.
  if (signals.servedBy === "cache") {
    out.push({
      stage: "answer cache",
      cause:
        "served from cache, not fresh retrieval — a wrong answer here is a stale entry or a near-but-different false hit",
      knob: "isolate with KNOWLEDGE_CACHE_ENABLED=false; invalidate the stale entry",
      severity: "medium",
    })
  }

  // Hallucination shape: confident, factual, but nothing resolved.
  if (cites === 0 && signals.abstained !== true && grounded === 0) {
    out.push({
      stage: "synthesis / retrieval",
      cause:
        "answer carries no resolving citations and groundedness 0 — out-of-corpus or ungrounded, surfaced as status=unsupported but still returned",
      knob: "KNOWLEDGE_ANSWER_POLICY minGroundedness to force a refusal; check retrieval actually returned sources",
      severity: "high",
    })
  }

  // Cited but not entailed (only visible when Tier-B ran).
  if ((signals.contradictedClaims ?? 0) > 0) {
    out.push({
      stage: "answer-time faithfulness (Tier-B)",
      cause: "a cited claim is not entailed by its snippet (cited-but-unsupported)",
      knob: "gate on status=needs_review; the Tier-B judge already flagged it",
      severity: "high",
    })
  }

  // Rests only on stale sources.
  if (signals.staleSourcesOnly === true) {
    out.push({
      stage: "source lifecycle",
      cause: "the answer rests only on deprecated/non-active sources",
      knob: "mark the current source active / deprecate the old one; raise its trustTier",
      severity: "medium",
    })
  }

  // Disagreeing sources — surfaced, not a fault.
  if ((signals.contestedCount ?? 0) > 0 || signals.status === "conflicted") {
    out.push({
      stage: "contested-sources (working as designed)",
      cause: "the sources genuinely disagree; the engine surfaced both sides",
      knob: "none — resolve the conflict in the corpus or pick a trustTier winner",
      severity: "info",
    })
  }

  // Honest decline.
  if (signals.abstained === true) {
    out.push({
      stage: "abstention (working as designed)",
      cause: "the engine declined — no sources, or a refusal it chose to surface",
      knob: "none if the corpus truly lacks the answer; else check retrieval/embeddings",
      severity: "info",
    })
  }

  // Weakly grounded but not caught above.
  if (cites > 0 && grounded < GROUNDEDNESS_FLOOR && out.length === 0) {
    out.push({
      stage: "retrieval",
      cause: "answer is weakly grounded (some claims uncited) though sources were retrieved",
      knob: "RERANK_ENABLED / tune RETRIEVAL_PARAMS; verify the right chunk is retrieved",
      severity: "medium",
    })
  }

  // Slowest stage (latency complaints).
  const slowest = (signals.phases ?? []).toSorted((a, b) => b.ms - a.ms)[0]
  if (slowest !== undefined && slowest.ms >= SLOW_PHASE_MS) {
    out.push({
      stage: `latency: ${slowest.phase}`,
      cause: `the ${slowest.phase} stage took ${slowest.ms}ms — the dominant cost`,
      knob: "disable/tune that stage; cache repeats; lower topK",
      severity: "info",
    })
  }

  // Looks healthy but reported wrong → the corpus, not the engine.
  if (out.length === 0 && cites > 0 && grounded >= GROUNDEDNESS_FLOOR) {
    out.push({
      stage: "source / corpus",
      cause:
        "the answer is grounded in resolving citations — if it is still wrong, the cited SOURCE is wrong or low-trust, not the pipeline",
      knob: "inspect the cited source's content / lifecycle / trustTier",
      severity: "info",
    })
  }

  return out
}
