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

/**
 * Per-edge actor authorization: who is allowed to CAUSE each transition. A human (`hitl:`) must
 * cause approve/decline; only the system apply/revert steps may cause those. This makes human
 * causation a MACHINE-enforced property, not a naming convention — the raw mutator cannot forge an
 * approval with a non-human actor (FR-12.2: remediation is never triggerable by an unattended agent).
 */
const REQUIRED_ACTOR: Partial<Record<RemediationState, (actor: string) => boolean>> = {
  approved: (actor) => actor.startsWith("hitl:"),
  declined: (actor) => actor.startsWith("hitl:"),
  applied: (actor) => actor === "system:apply",
  reverted: (actor) => actor === "system:revert",
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
  const requiredActor = REQUIRED_ACTOR[input.to]
  if (requiredActor !== undefined && !requiredActor(input.actor)) {
    return err({
      from: entry.state,
      to: input.to,
      message: `transition to ${input.to} requires an authorized actor, got "${input.actor}"`,
    })
  }
  const event: LedgerEvent = Object.freeze({
    at: input.at,
    from: entry.state,
    to: input.to,
    actor: input.actor,
    note: input.note,
  })
  // Deep-copy + freeze the recorded edits so no caller alias can rewrite the ledger after the fact,
  // and so distinct entries never share a mutable array (runtime immutability, not just `readonly`).
  const edits =
    input.to === "applied"
      ? Object.freeze((input.edits ?? []).map((e) => Object.freeze({ ...e })))
      : entry.edits
  return ok(
    Object.freeze({
      ...entry,
      state: input.to,
      edits,
      history: Object.freeze([...entry.history, event]),
    }),
  )
}
