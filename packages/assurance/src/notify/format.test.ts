import type { DriftAlert } from "@agenticmind/assurance/bundle/drift"
import type { RemediationLedgerEntry } from "@agenticmind/assurance/remediate/ledger"

import { describe, expect, it } from "vitest"

import { formatApprovalRequest, formatDriftAlert } from "./index"

describe("formatDriftAlert", () => {
  it("renders regressions as `control from→to` and preserves severity", () => {
    const alert: DriftAlert = {
      severity: "critical",
      message: "1 control regressed — a control fell green→red.",
      regressions: [{ controlId: "AAL-SEC-01", from: "green", to: "red" }],
    }
    const n = formatDriftAlert("agenticmind-engine", alert)
    expect(n.kind).toBe("drift")
    expect(n.severity).toBe("critical")
    expect(n.body).toContain("AAL-SEC-01 green→red")
    expect(n.context.target).toBe("agenticmind-engine")
    expect(n.context.regressions).toBe(1)
  })

  it("falls back to the bare message when no regressions are listed", () => {
    const n = formatDriftAlert("t", { severity: "warning", message: "drift", regressions: [] })
    expect(n.body).toBe("drift")
  })
})

describe("formatApprovalRequest", () => {
  it("carries only ids — never the verdict rationale or edit content", () => {
    const entry: RemediationLedgerEntry = {
      id: "rem:fix:x",
      proposalId: "fix:x",
      findingId: "atk-1",
      state: "pending_approval",
      verdict: { verdict: "supported", rationale: "SENSITIVE_RATIONALE" },
      edits: [],
      history: [],
    }
    const n = formatApprovalRequest(entry)
    expect(n.kind).toBe("approval-request")
    expect(n.severity).toBe("info")
    expect(n.context.remediationId).toBe("rem:fix:x")
    expect(n.context.findingId).toBe("atk-1")
    expect(JSON.stringify(n)).not.toContain("SENSITIVE_RATIONALE")
  })
})
