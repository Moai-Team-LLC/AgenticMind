/**
 * Pure formatters: turn a drift alert or a pending remediation into a payload-free
 * `AssuranceNotification`. No I/O, so they unit-test offline; the transport is `channel.ts`.
 */
import type { DriftAlert } from "../bundle/drift"
import type { RemediationLedgerEntry } from "../remediate/ledger"
import type { AssuranceNotification } from "./channel"

/** Format a drift alert for a target into a notification (regressions as `control from→to`). */
export function formatDriftAlert(target: string, alert: DriftAlert): AssuranceNotification {
  const changes = alert.regressions.map((r) => `${r.controlId} ${r.from}→${r.to}`).join(", ")
  return {
    kind: "drift",
    severity: alert.severity,
    title: `Assurance drift on ${target}`,
    body: changes === "" ? alert.message : `${alert.message} (${changes})`,
    context: {
      target,
      regressions: alert.regressions.length,
      severity: alert.severity,
    },
  }
}

/**
 * Format an L3 pending-approval remediation into an approval request. A human must approve/decline
 * through the channel before the fix applies (FR-11.3) — the notification carries only ids, never
 * the proposed edit content.
 */
export function formatApprovalRequest(entry: RemediationLedgerEntry): AssuranceNotification {
  return {
    kind: "approval-request",
    severity: "info",
    title: `Remediation awaiting approval: ${entry.proposalId}`,
    body: `Finding ${entry.findingId}: a structural fix passed the judge and needs human approval before it applies.`,
    context: {
      remediationId: entry.id,
      proposalId: entry.proposalId,
      findingId: entry.findingId,
      state: entry.state,
    },
  }
}
