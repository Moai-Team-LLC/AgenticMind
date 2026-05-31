/**
 * Feedback signal vocabulary — pure, ported from
 * services/knowledge/internal/feedback/feedback.go. The closed signal set +
 * canonical strengths drive the /ask/feedback endpoints and the promoter's
 * cluster scoring. Recording lives in the ask-feedback query module; the
 * clustering + promotion loop is a separate (BullMQ) brick.
 */

export const FEEDBACK_SIGNALS = [
  // Human signals (member UI / admin)
  "thumb_up",
  "thumb_down",
  "claimed_deal",
  "requested_intro",
  "forwarded_answer",
  "thanks_message",
  "silent_no_followup",
  "no_repeat_in_window",
  "reformulated_immediately",
  "escalated_to_admin",
  "repeat_question_24h",
  "admin_marked_wrong",
  "admin_marked_helpful",
  // Programmatic signals (agents / evals / verifiers) — these let the
  // Compounding loop self-improve WITHOUT a human in the loop: an agent or
  // An eval emits them, and they drive the same clustering → judge →
  // Resolution-card promotion path that human thumbs do.
  "verified_supported",
  "verification_failed",
  "eval_passed",
  "eval_failed",
  "downstream_success",
  "downstream_failure",
  "used_in_generation",
] as const

export type FeedbackSignal = (typeof FEEDBACK_SIGNALS)[number]

/** Admin-only marker signals — rejected on the public member route. */
export const ADMIN_ONLY_SIGNALS = new Set<FeedbackSignal>([
  "admin_marked_wrong",
  "admin_marked_helpful",
])

/**
 * Programmatic signals emitted by agents, evals, or verifiers (not humans).
 * Allowed on the agent/MCP surface; rejected on the human member route.
 */
export const AGENT_SIGNALS = new Set<FeedbackSignal>([
  "verified_supported",
  "verification_failed",
  "eval_passed",
  "eval_failed",
  "downstream_success",
  "downstream_failure",
  "used_in_generation",
])

export const isValidSignal = (s: string): s is FeedbackSignal =>
  (FEEDBACK_SIGNALS as readonly string[]).includes(s)

/** True for programmatic (agent/eval/verifier) signals. */
export const isAgentSignal = (s: FeedbackSignal): boolean => AGENT_SIGNALS.has(s)

const STRENGTHS: Record<FeedbackSignal, number> = {
  // Human
  claimed_deal: 1,
  requested_intro: 1,
  admin_marked_helpful: 1,
  forwarded_answer: 0.8,
  thumb_up: 0.7,
  thanks_message: 0.7,
  silent_no_followup: 0.3,
  no_repeat_in_window: 0.3,
  repeat_question_24h: -0.4,
  reformulated_immediately: -0.6,
  thumb_down: -0.7,
  escalated_to_admin: -0.8,
  admin_marked_wrong: -1,
  // Programmatic (agents / evals / verifiers)
  verified_supported: 1,
  eval_passed: 0.9,
  downstream_success: 0.8,
  used_in_generation: 0.5,
  downstream_failure: -0.7,
  eval_failed: -0.9,
  verification_failed: -1,
}

/**
 * Canonical strength for a signal: sign = direction (correct/incorrect),
 * magnitude = confidence in [0,1]. Used when the caller omits an explicit
 * strength; the promoter aggregates clusters with these weights.
 */
export const defaultStrengthFor = (s: FeedbackSignal): number => STRENGTHS[s]

/** Clamps an arbitrary upstream strength into [-1, 1]. */
export const clampStrength = (v: number): number => (v < -1 ? -1 : Math.min(1, v))
