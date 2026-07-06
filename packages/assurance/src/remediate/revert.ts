/**
 * One-command revert (FR-11.3). Invert an applied remediation's edits and record the reverted state.
 * The inverse edits are themselves re-checked through the Cycle-of-Trust guard (fail-closed): a
 * revert can never move the config into a forbidden state either. Only an `applied` entry can be
 * reverted — the ledger's transition validator refuses anything else.
 */
import { err, type Result } from "neverthrow"

import type { AppliedEdit, RemediationLedgerEntry } from "./ledger"
import type { FixProposal, ProposedEdit } from "./proposal"

import { enforceCycleOfTrust } from "./guard"
import { transition } from "./ledger"

const INVERSE_OP: Record<AppliedEdit["op"], AppliedEdit["op"]> = {
  add: "remove",
  remove: "add",
  modify: "modify",
}

/** The inverse of an applied edit: invert the op and swap before/after. */
export function invertEdit(edit: AppliedEdit): AppliedEdit {
  return { path: edit.path, op: INVERSE_OP[edit.op], before: edit.after, after: edit.before }
}

export interface RevertError {
  kind: "guard" | "transition"
  message: string
}

/** Revert an applied remediation: the recorded edits are inverted, guard-checked, and marked reverted. */
export function revertRemediation(
  entry: RemediationLedgerEntry,
  at: string,
): Result<RemediationLedgerEntry, RevertError> {
  const inverse = entry.edits.map(invertEdit)
  const proposed: ProposedEdit[] = inverse.map((e) => ({
    path: e.path,
    op: e.op,
    summary: "revert",
  }))
  const guardProposal: FixProposal = {
    id: entry.proposalId,
    findingId: entry.findingId,
    target: "prompt",
    rationale: "revert re-check",
    edits: proposed,
  }
  const guard = enforceCycleOfTrust(guardProposal)
  if (!guard.allowed) {
    return err({
      kind: "guard",
      message: `revert refused by Cycle-of-Trust: ${guard.violations.map((v) => v.reason).join("; ")}`,
    })
  }
  return transition(entry, {
    to: "reverted",
    actor: "system:revert",
    note: `reverted ${inverse.length} edit(s)`,
    at,
  }).mapErr((e) => ({ kind: "transition" as const, message: e.message }))
}
