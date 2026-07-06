/**
 * L3 judge gate (FR-11.3).
 *
 * Before an autonomous remediation may reach a human approver it passes two gates, in order:
 *   1. the Cycle-of-Trust guard (mechanical, un-overridable) — a forbidden-surface edit is refused
 *      here and never reaches the judge;
 *   2. a judge (AgenticMind's feedback judge — reused, not reinvented) that must return "supported"
 *      for the fix to be a valid, sufficient, on-target STRUCTURAL remediation of the finding.
 *
 * Fail-closed everywhere: a judge error, timeout, "unknown", or anything short of "supported" makes
 * the proposal NOT eligible to advance. The gate never applies anything — even a supported fix still
 * requires async HITL approval before it lands. The judge is a pluggable provider (offline: a fake;
 * in-monorepo: a thin adapter that feeds `buildJudgePrompt` to the engine's chat/judge and maps the
 * verdict), mirroring how the Core oracle and the collect-db seam are wired.
 */
import type { FixProposal, GuardResult } from "./proposal"

import { enforceCycleOfTrust } from "./guard"

/** The engine feedback judge's verdict vocabulary (packages/shared/.../feedback-judge.ts), reused. */
export type RemediationVerdict = "supported" | "partially_supported" | "unsupported" | "unknown"

export interface RemediationJudgeResult {
  verdict: RemediationVerdict
  rationale: string
}

/** Pluggable judge. In-monorepo adapter: feed `buildJudgePrompt(proposal)` to the engine's judge. */
export type RemediationJudge = (proposal: FixProposal) => Promise<RemediationJudgeResult>

export type GateDecision = "guard_rejected" | "judge_rejected" | "pending_approval"

export interface GateOutcome {
  decision: GateDecision
  guard: GuardResult
  verdict: RemediationJudgeResult | null
  reason: string
}

/** The one verdict that clears the judge gate — mirrors the engine's `judgeAllowsPromotion`. */
const JUDGE_PASS: RemediationVerdict = "supported"

/**
 * Build the judge prompt for a proposal (pure — the LLM call is the injected seam). Payload-free:
 * only the structural summary + rationale, never a raw attack payload or secret.
 */
export function buildJudgePrompt(proposal: FixProposal): string {
  const edits = proposal.edits.map((e) => `- ${e.op} ${e.path}: ${e.summary}`).join("\n")
  return [
    "You are an assurance auditor reviewing a proposed STRUCTURAL remediation for a security finding.",
    "Decide whether the fix is a valid, sufficient, on-target structural change for the finding.",
    "Answer exactly one of: supported | partially_supported | unsupported | unknown, with a rationale.",
    "",
    `Finding: ${proposal.findingId}`,
    `Target surface: ${proposal.target}`,
    `Rationale: ${proposal.rationale}`,
    `Edits:\n${edits}`,
  ].join("\n")
}

/**
 * Gate a proposal for L3. Guard first (un-overridable); then the judge; "supported" advances to
 * pending HITL approval. Every other outcome — including a thrown judge — is fail-closed.
 */
export async function gateProposal(
  proposal: FixProposal,
  judge: RemediationJudge,
): Promise<GateOutcome> {
  const guard = enforceCycleOfTrust(proposal)
  if (!guard.allowed) {
    return {
      decision: "guard_rejected",
      guard,
      verdict: null,
      reason: `Cycle-of-Trust guard refused ${guard.violations.length} edit(s); judge not consulted.`,
    }
  }

  let verdict: RemediationJudgeResult
  try {
    verdict = await judge(proposal)
  } catch (cause) {
    return {
      decision: "judge_rejected",
      guard,
      verdict: null,
      reason: `judge errored (fail-closed): ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }

  // A pluggable judge may mis-map a malformed engine response to a non-object; validate the shape
  // before dereferencing so a bad provider fails closed instead of throwing out of the gate.
  const resolved = verdict as unknown
  if (
    resolved === null ||
    typeof resolved !== "object" ||
    typeof (resolved as { verdict?: unknown }).verdict !== "string"
  ) {
    return {
      decision: "judge_rejected",
      guard,
      verdict: null,
      reason: "judge returned a malformed verdict (fail-closed).",
    }
  }

  if (verdict.verdict !== JUDGE_PASS) {
    return {
      decision: "judge_rejected",
      guard,
      verdict,
      reason: `judge returned "${verdict.verdict}" (only "supported" clears the gate).`,
    }
  }

  return {
    decision: "pending_approval",
    guard,
    verdict,
    reason: "guard passed and judge supported; awaiting async HITL approval before apply.",
  }
}
