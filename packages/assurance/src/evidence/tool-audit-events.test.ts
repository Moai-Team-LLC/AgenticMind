import { describe, expect, it } from "vitest"

import { collectToolAuditEvents, type ToolAuditEventRow } from "./tool-audit-events"

const AT = "2026-07-03T00:00:00Z"

const row = (over: Partial<ToolAuditEventRow>): ToolAuditEventRow => ({
  id: "tae1",
  source: "claude-code-hook",
  eventKind: "PostToolUse",
  actorUuid: "actor-1",
  sessionId: "sess-1",
  tool: "Bash",
  decision: "accept",
  payloadHash: "a".repeat(64),
  metadata: { cwd_present: true },
  createdAt: AT,
  ...over,
})

describe("tool_audit_events collector", () => {
  it("maps logged tool events to the accountability audit-trail controls", () => {
    const rows: ToolAuditEventRow[] = [
      row({ id: "t1", eventKind: "PostToolUse", tool: "Bash", decision: "accept" }),
      row({ id: "t2", eventKind: "PermissionRequest", tool: "Write", decision: "deny" }),
      row({ id: "t3", eventKind: "ConfigChange", tool: null, decision: null }),
    ]
    const ev = collectToolAuditEvents(rows, AT)
    const controls = new Set(ev.map((e) => e.controlId))
    // Audit trail (AAL-ACC-03) + per-action decision traceability (AAL-ACC-01).
    expect(controls).toEqual(new Set(["AAL-ACC-01", "AAL-ACC-03"]))
    // Deterministic + payload-free: the summary carries counts, never raw text.
    for (const e of ev) {
      expect(e.collector).toBe("native")
      expect(e.collectedAt).toBe(AT)
      expect(e.summary).not.toContain("a".repeat(64)) // no raw payload / hash dumped
    }
  })

  it("still logs the audit trail when events carry no actor/session provenance", () => {
    // Provenance-less events are still an audit trail (ACC-03) but do not claim traceability (ACC-01).
    const rows: ToolAuditEventRow[] = [
      row({ id: "t1", actorUuid: null, sessionId: null, decision: null }),
    ]
    const controls = new Set(collectToolAuditEvents(rows, AT).map((e) => e.controlId))
    expect(controls).toEqual(new Set(["AAL-ACC-03"]))
  })

  it("over-claims nothing on an empty set", () => {
    expect(collectToolAuditEvents([], AT)).toEqual([])
  })
})
