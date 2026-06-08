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

import * as z from "zod"

export const answerPolicySchema = z
  .object({
    /** Block (refuse) answers whose Tier-A groundedness is below this (0..1). */
    minGroundedness: z.number().min(0).max(1).optional(),
    /** Block answers whose Tier-B semantic groundedness is below this, when Tier-B ran. */
    minSemanticGroundedness: z.number().min(0).max(1).optional(),
    /** Block (refuse to serve a winner) when the sources conflict. */
    blockOnConflict: z.boolean().optional(),
    /** Flag conflicted answers for human review (served, but marked). */
    reviewOnConflict: z.boolean().optional(),
    /** Flag needs_review answers (a cited claim not entailed by its snippet). */
    reviewOnNeedsReview: z.boolean().optional(),
  })
  .strict()
export type AnswerPolicy = z.infer<typeof answerPolicySchema>

export type PolicyAction = "allow" | "review" | "block"
export type PolicyDecision = { action: PolicyAction; reasons: string[] }

/** The answer text substituted when a policy BLOCKS an under-grounded answer. */
export const POLICY_BLOCK_MESSAGE =
  "I can't give a sufficiently source-grounded answer to that under this deployment's answer policy."

/** Parses + validates the KNOWLEDGE_ANSWER_POLICY env JSON. Fail-soft: a malformed
 * or empty value yields undefined (no policy), never a crash. */
export const parseAnswerPolicy = (raw: string | undefined | null): AnswerPolicy | undefined => {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const res = answerPolicySchema.safeParse(parsed)
  return res.success ? res.data : undefined
}

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
  const grounded = input.groundedness ?? 1

  if (policy.minGroundedness !== undefined && grounded < policy.minGroundedness) {
    reasons.push(`groundedness ${grounded.toFixed(2)} < ${policy.minGroundedness}`)
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
  if (reasons.length > 0) {
    return { action: "block", reasons }
  }

  if (policy.reviewOnConflict === true && input.status === "conflicted") {
    reasons.push("sources conflict (reviewOnConflict)")
  }
  if (policy.reviewOnNeedsReview === true && input.status === "needs_review") {
    reasons.push("a cited claim is not entailed by its snippet (reviewOnNeedsReview)")
  }
  return reasons.length > 0 ? { action: "review", reasons } : { action: "allow", reasons: [] }
}
