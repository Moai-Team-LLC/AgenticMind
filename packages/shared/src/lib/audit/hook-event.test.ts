import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"

import { AUDIT_WRITE_SCOPE, hasAuditWriteScope, parseHookEvent } from "./hook-event"

describe("hasAuditWriteScope", () => {
  it("gates on the audit:write scope", () => {
    expect(hasAuditWriteScope([AUDIT_WRITE_SCOPE])).toBe(true)
    expect(hasAuditWriteScope(["knowledge:read", "audit:write"])).toBe(true)
    expect(hasAuditWriteScope(["knowledge:read", "knowledge:write"])).toBe(false)
    expect(hasAuditWriteScope([])).toBe(false)
    expect(hasAuditWriteScope()).toBe(false)
  })
})

describe("parseHookEvent", () => {
  it("maps a PostToolUse payload to structural fields", () => {
    const parsed = parseHookEvent({
      hook_event_name: "PostToolUse",
      session_id: "sess-123",
      tool_name: "Bash",
      cwd: "/repo",
      permission_mode: "default",
      tool_input: { command: "rm secret.txt" },
      tool_response: { decision: "accept" },
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.eventKind).toBe("PostToolUse")
    expect(parsed?.sessionId).toBe("sess-123")
    expect(parsed?.tool).toBe("Bash")
    expect(parsed?.decision).toBe("accept")
    expect(parsed?.metadata.cwd).toBe("/repo")
    expect(parsed?.metadata.permission_mode).toBe("default")
  })

  it("never stores raw tool input/response — only presence flags + a hash", () => {
    const raw = {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/etc/passwd", content: "SUPER_SECRET" },
    }
    const parsed = parseHookEvent(raw)
    const serialized = JSON.stringify(parsed)
    expect(serialized).not.toContain("SUPER_SECRET")
    expect(serialized).not.toContain("/etc/passwd")
    expect(parsed?.metadata.has_tool_input).toBe(true)
    expect(parsed?.metadata.has_tool_response).toBe(false)
    expect(parsed?.payloadHash).toBe(createHash("sha256").update(JSON.stringify(raw)).digest("hex"))
  })

  it("reads the `event` alias and camelCase field variants", () => {
    const parsed = parseHookEvent({
      event: "ConfigChange",
      sessionId: "s9",
      permissionMode: "plan",
    })
    expect(parsed?.eventKind).toBe("ConfigChange")
    expect(parsed?.sessionId).toBe("s9")
    expect(parsed?.metadata.permission_mode).toBe("plan")
  })

  it("rejects non-objects and payloads with no event name", () => {
    expect(parseHookEvent(null)).toBeNull()
    expect(parseHookEvent("PostToolUse")).toBeNull()
    expect(parseHookEvent(["PostToolUse"])).toBeNull()
    expect(parseHookEvent({ tool_name: "Bash" })).toBeNull()
  })
})
