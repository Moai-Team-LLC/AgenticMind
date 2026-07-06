/**
 * L3 orchestration (FR-11.3). Open a ledger entry from a gate outcome, record the async HITL
 * decision, and apply an approved fix as a reversible diff. Apply RE-runs the Cycle-of-Trust guard
 * on the concrete edit PATHS (defense in depth): even a judge-supported, human-approved proposal
 * cannot land a forbidden edit if the concrete content drifted from the reviewed summary.
 *
 * This records the remediation; the actual write of the structural edit into the target agent's
 * config is an external integration and, per FR-12.2, MUST NOT be triggered by an unattended agent —
 * a human approves through the HITL channel first.
 */
import { err, type Result } from "neverthrow"

import type { GateOutcome } from "./judge"
import type { AppliedEdit, RemediationLedgerEntry, TransitionError } from "./ledger"
import type { FixProposal, ProposedEdit } from "./proposal"

import { enforceCycleOfTrust } from "./guard"
import { deepFreeze, transition } from "./ledger"

/** Re-express concrete applied edits as a proposal so the path-based guard can vet them. */
function asGuardProposal(
  entry: Pick<RemediationLedgerEntry, "proposalId" | "findingId">,
  edits: readonly AppliedEdit[],
  rationale: string,
): FixProposal {
  const proposed: ProposedEdit[] = edits.map((e) => ({
    path: e.path,
    op: e.op,
    summary: "re-check",
  }))
  return {
    id: entry.proposalId,
    findingId: entry.findingId,
    target: "prompt",
    rationale,
    edits: proposed,
  }
}

/** Open a ledger entry from a gated proposal. The entry's initial state IS the gate decision. */
export function openRemediation(
  proposal: FixProposal,
  gate: GateOutcome,
  at: string,
): RemediationLedgerEntry {
  return Object.freeze({
    id: `rem:${proposal.id}`,
    proposalId: proposal.id,
    findingId: proposal.findingId,
    state: gate.decision,
    // Deep-copy + freeze the verdict too, so the recorded judge decision cannot be rewritten via a
    // caller alias (audit/provenance integrity) — the fix that froze edits/history missed this.
    verdict: gate.verdict === null ? null : deepFreeze({ ...gate.verdict }),
    edits: Object.freeze([]),
    history: Object.freeze([
      Object.freeze({ at, from: null, to: gate.decision, actor: "system:gate", note: gate.reason }),
    ]),
  })
}

/** HITL approves a pending remediation. */
export function approveRemediation(
  entry: RemediationLedgerEntry,
  approver: string,
  at: string,
): Result<RemediationLedgerEntry, TransitionError> {
  return transition(entry, { to: "approved", actor: `hitl:${approver}`, note: "approved", at })
}

/** HITL declines a pending remediation. */
export function declineRemediation(
  entry: RemediationLedgerEntry,
  approver: string,
  at: string,
  note = "declined",
): Result<RemediationLedgerEntry, TransitionError> {
  return transition(entry, { to: "declined", actor: `hitl:${approver}`, note, at })
}

export interface ApplyError {
  kind: "guard" | "transition"
  message: string
}

/**
 * Apply an approved remediation as a reversible diff. The concrete edits are re-checked through the
 * Cycle-of-Trust guard before they land (fail-closed) — only then does the entry reach `applied`.
 */
export function applyRemediation(
  entry: RemediationLedgerEntry,
  edits: readonly AppliedEdit[],
  at: string,
): Result<RemediationLedgerEntry, ApplyError> {
  // Consistency assertion: an entry reaching apply must carry a recorded HITL approval. The SOUND
  // control is the un-exported, actor-enforced state machine (a non-hitl actor cannot reach
  // `approved`); this is defense-in-depth for module-produced entries, NOT tamper-evidence — a
  // caller that fabricates an entry wholesale is outside the in-process trust model.
  const humanApproved = entry.history.some(
    (e) => e.to === "approved" && e.actor.startsWith("hitl:"),
  )
  if (!humanApproved) {
    return err({
      kind: "transition",
      message: "apply refused: no HITL approval recorded in history (FR-12.2).",
    })
  }
  const guard = enforceCycleOfTrust(asGuardProposal(entry, edits, "apply-time re-check"))
  if (!guard.allowed) {
    return err({
      kind: "guard",
      message: `apply refused by Cycle-of-Trust: ${guard.violations.map((v) => v.reason).join("; ")}`,
    })
  }
  return transition(entry, {
    to: "applied",
    actor: "system:apply",
    note: `applied ${edits.length} reversible edit(s)`,
    at,
    edits,
  }).mapErr((e) => ({ kind: "transition" as const, message: e.message }))
}
