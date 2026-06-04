import { describe, expect, it } from "vitest"

import { DEFAULT_SCOPES, hasScope, isKnowledgeScope, TOOL_SCOPE } from "./mcp-scopes"

describe("mcp scopes", () => {
  it("defaults to read-only", () => {
    expect(DEFAULT_SCOPES).toEqual(["knowledge:read"])
  })

  it("validates scope strings", () => {
    expect(isKnowledgeScope("knowledge:signal")).toBe(true)
    expect(isKnowledgeScope("knowledge:admin")).toBe(true)
    expect(isKnowledgeScope("knowledge:destroy")).toBe(false)
  })

  it("grants only what is present (fail-closed)", () => {
    expect(hasScope(["knowledge:read"], "knowledge:read")).toBe(true)
    expect(hasScope(["knowledge:read"], "knowledge:signal")).toBe(false)
    expect(hasScope(["knowledge:read", "knowledge:signal"], "knowledge:signal")).toBe(true)
    expect(hasScope(undefined, "knowledge:read")).toBe(false)
    expect(hasScope(null, "knowledge:signal")).toBe(false)
    expect(hasScope([], "knowledge:read")).toBe(false)
  })

  it("maps each tool to its least-privilege scope", () => {
    expect(TOOL_SCOPE.kl_signal).toBe("knowledge:signal")
    expect(TOOL_SCOPE.kl_ask_global).toBe("knowledge:read")
    expect(TOOL_SCOPE.kl_ingest).toBe("knowledge:write")
    expect(TOOL_SCOPE.kl_forget).toBe("knowledge:admin")
  })
})
