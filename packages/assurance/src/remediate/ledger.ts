/**
 * Remediation ledger (FR-11.3 — a recorded, revertable diff).
 *
 * An append-only, immutable record of a remediation's lifecycle. Each transition returns a NEW entry
 * with the event appended to `history`; nothing is mutated in place. Transitions are validated
 * against the allowed lifecycle, so the ladder cannot skip HITL approval or apply an un-approved
 * fix — an illegal transition is a typed error, never a silent state change (fail-closed).
 *
 * Lifecycle:
 *   guard_rejected ┐
 *   judge_rejected ┴─ terminal (never entered the human loop)
 *   pending_approval ─▶ approved ─▶ applied ─▶ reverted (terminal)
 *                    └▶ declined (terminal)
 */
import { err, ok, type Result } from "neverthrow"

import type { RemediationJudgeResult } from "./judge"

export type RemediationState =
  | "guard_rejected"
  | "judge_rejected"
  | "pending_approval"
  | "approved"
  | "applied"
  | "reverted"
  | "declined"

/**
 * A concrete, reversible structural-config edit. The content is configuration (prompt text, a
 * declared mitigation) — never a secret or attack payload — so `before`/`after` may be recorded to
 * make the change revertable. `null` marks an absent side (add has no `before`, remove no `after`).
 */
export interface AppliedEdit {
  path: string
  op: "add" | "modify" | "remove"
  before: string | null
  after: string | null
}

export interface LedgerEvent {
  readonly at: string
  readonly from: RemediationState | null
  readonly to: RemediationState
  /** Who caused it: "system:gate" | "hitl:<approver>" | "system:apply" | "system:revert". */
  readonly actor: string
  readonly note: string
}

export interface RemediationLedgerEntry {
  readonly id: string
  readonly proposalId: string
  readonly findingId: string
  readonly state: RemediationState
  readonly verdict: RemediationJudgeResult | null
  /** Forward edits — empty until the entry reaches `applied`. */
  readonly edits: readonly AppliedEdit[]
  readonly history: readonly LedgerEvent[]
}

export interface TransitionError {
  from: RemediationState
  to: RemediationState
  message: string
}

/** Allowed lifecycle edges. Anything not listed is refused (fail-closed). */
const ALLOWED: Record<RemediationState, readonly RemediationState[]> = {
  guard_rejected: [],
  judge_rejected: [],
  pending_approval: ["approved", "declined"],
  approved: ["applied"],
  applied: ["reverted"],
  reverted: [],
  declined: [],
}

export interface TransitionInput {
  to: RemediationState
  actor: string
  note: string
  at: string
  /** Only recorded on the transition to `applied`. */
  edits?: readonly AppliedEdit[]
}

/** Validate and apply a transition, returning a NEW immutable entry (fail-closed on illegal edges). */
export function transition(
  entry: RemediationLedgerEntry,
  input: TransitionInput,
): Result<RemediationLedgerEntry, TransitionError> {
  if (!ALLOWED[entry.state].includes(input.to)) {
    return err({
      from: entry.state,
      to: input.to,
      message: `illegal transition ${entry.state} -> ${input.to}`,
    })
  }
  const event: LedgerEvent = {
    at: input.at,
    from: entry.state,
    to: input.to,
    actor: input.actor,
    note: input.note,
  }
  return ok({
    ...entry,
    state: input.to,
    edits: input.to === "applied" ? (input.edits ?? []) : entry.edits,
    history: [...entry.history, event],
  })
}
