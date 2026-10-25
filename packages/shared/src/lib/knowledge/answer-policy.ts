/**
 * Answer policy — turns the faithfulness signals from a REPORT into an enforced
 * DECISION. By default AgenticMind surfaces groundedness/status and lets the
 * caller decide; a policy lets an operator make that call structural: refuse
 * answers below a groundedness floor, or flag conflicted / cited-but-unentailed
 * answers for human review — below the application and the model.
 *
 * Configured per deployment via the KNOWLEDGE_ANSWER_POLICY env JSON (unset = no
 * policy = today's behaviour). Pure: the schema, the parser, and the evaluator —
 * applying the decision to an Answer lives in ask.ts. Unit-tested with canned
 * signals.
 */

import type { AnswerStatus } from "@agenticmind/shared/lib/knowledge/answer-status"
import type { Profile } from "@agenticmind/shared/lib/profile"
import type { Result } from "neverthrow"

import { isStrict } from "@agenticmind/shared/lib/profile"
import { err, ok } from "neverthrow"
import * as z from "zod"

export const answerPolicySchema = z
  .object({
    /** Block (refuse) answers whose Tier-A groundedness is below this (0..1). */
    minGroundedness: z.number().min(0).max(1).optional(),
    /** Block answers whose Tier-B semantic groundedness is below this, when Tier-B ran. */
    minSemanticGroundedness: z.number().min(0).max(1).optional(),
    /** Block (refuse to serve a winner) when the sources conflict. */
    blockOnConflict: z.boolean().optional(),
    /** Block (refuse) any answer the engine flagged `needs_review` — the single
     * switch over ALL deterministic hallucination signals (fabricated figure,
     * mis-attributed citation, fabricated quote, cited-but-unentailed claim,
     * stale-only sources). Turns detection (A–F) into hard prevention. */
    blockOnNeedsReview: z.boolean().optional(),
    /** Flag conflicted answers for human review (served, but marked). */
    reviewOnConflict: z.boolean().optional(),
    /** Flag needs_review answers (a cited claim not entailed by its snippet). */
    reviewOnNeedsReview: z.boolean().optional(),
    /** Require the Tier-B semantic signal: when it is absent (Tier-B off or the
     * judge failed), "review" marks the answer needs_review and "block" refuses it.
     * Without this, a missing signal skips `minSemanticGroundedness` silently. */
    requireSemanticVerification: z.enum(["review", "block"]).optional(),
    /** What a missing Tier-A groundedness signal does against `minGroundedness`:
     * "pass" (default in `standard`, today's behaviour) or "block" (default in
     * `strict`). */
    missingGroundedness: z.enum(["pass", "block"]).optional(),
  })
  .strict()
export type AnswerPolicy = z.infer<typeof answerPolicySchema>

export type PolicyAction = "allow" | "review" | "block"
export type PolicyDecision = { action: PolicyAction; reasons: string[] }

/** The answer text substituted when a policy BLOCKS an under-grounded answer. */
export const POLICY_BLOCK_MESSAGE =
  "I can't give a sufficiently source-grounded answer to that under this deployment's answer policy."

/**
 * Parses + validates the KNOWLEDGE_ANSWER_POLICY env JSON, telling "not set"
 * (ok null) apart from "set but invalid" (err). The strict profile refuses
 * to start on the error; standard ignores it, as before.
 */
export const parseAnswerPolicyResult = (
  raw: string | undefined | null,
): Result<AnswerPolicy | null, string> => {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return ok(null)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return err(`not valid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
  const res = answerPolicySchema.safeParse(parsed)
  if (!res.success) {
    return err(
      res.error.issues
        .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
        .join("; "),
    )
  }
  return ok(res.data)
}

/** Parses + validates the KNOWLEDGE_ANSWER_POLICY env JSON. Fail-soft: a malformed
 * or empty value yields undefined (no policy), never a crash. */
export const parseAnswerPolicy = (raw: string | undefined | null): AnswerPolicy | undefined => {
  const res = parseAnswerPolicyResult(raw)
  return res.isOk() && res.value !== null ? res.value : undefined
}

/** The strict profile's defaults: an absent groundedness signal fails the floor
 * instead of passing it. An explicit setting in the policy wins. */
export const withProfileDefaults = (
  policy: AnswerPolicy | undefined,
  profile: Profile,
): AnswerPolicy | undefined =>
  policy === undefined || !isStrict(profile) ? policy : { missingGroundedness: "block", ...policy }

/** Why a policy marked an answer whose Tier-B signal is absent. */
export const SEMANTIC_MISSING_REASON =
  "semantic verification required but the signal is missing (requireSemanticVerification)"

/** Signals the policy decides on (a subset of the Answer). */
export type PolicyInput = {
  status: AnswerStatus
  groundedness?: number
  semanticGroundedness?: number
}

/**
 * Evaluates a policy against one answer's signals. Block conditions (too
 * ungrounded / conflicting) win over review conditions; with no matching rule the
 * action is "allow". Reasons accumulate for the trace.
 */
export const evaluatePolicy = (policy: AnswerPolicy, input: PolicyInput): PolicyDecision => {
  const reasons: string[] = []
  const semanticMissing = input.semanticGroundedness === undefined

  if (policy.minGroundedness !== undefined) {
    if (input.groundedness === undefined) {
      if (policy.missingGroundedness === "block") {
        reasons.push("groundedness signal missing (missingGroundedness: block)")
      }
    } else if (input.groundedness < policy.minGroundedness) {
      reasons.push(`groundedness ${input.groundedness.toFixed(2)} < ${policy.minGroundedness}`)
    }
  }
  if (policy.requireSemanticVerification === "block" && semanticMissing) {
    reasons.push(SEMANTIC_MISSING_REASON)
  }
  if (
    policy.minSemanticGroundedness !== undefined &&
    input.semanticGroundedness !== undefined &&
    input.semanticGroundedness < policy.minSemanticGroundedness
  ) {
    reasons.push(
      `semanticGroundedness ${input.semanticGroundedness.toFixed(2)} < ${policy.minSemanticGroundedness}`,
    )
  }
  if (policy.blockOnConflict === true && input.status === "conflicted") {
    reasons.push("sources conflict (blockOnConflict)")
  }
  if (policy.blockOnNeedsReview === true && input.status === "needs_review") {
    reasons.push("answer flagged needs_review by a deterministic check (blockOnNeedsReview)")
  }
  if (reasons.length > 0) {
    return { action: "block", reasons }
  }

  if (policy.reviewOnConflict === true && input.status === "conflicted") {
    reasons.push("sources conflict (reviewOnConflict)")
  }
  if (policy.reviewOnNeedsReview === true && input.status === "needs_review") {
    reasons.push("a cited claim is not entailed by its snippet (reviewOnNeedsReview)")
  }
  if (policy.requireSemanticVerification === "review" && semanticMissing) {
    reasons.push(SEMANTIC_MISSING_REASON)
  }
  return reasons.length > 0 ? { action: "review", reasons } : { action: "allow", reasons: [] }
}
