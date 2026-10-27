// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import {
  PENDING_FIELDS,
  PENDING_RELEASE,
  PENDING_TOOLS,
  pendingFieldsIn,
  pendingFieldsMessage,
} from "@agenticmind/shared/lib/knowledge/contract-pending"
import { KNOWLEDGE_MCP_TOOLS } from "@agenticmind/shared/lib/knowledge/mcp-tools"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as z from "zod"

const PACKAGE_VERSION = (
  JSON.parse(readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8")) as {
    version: string
  }
).version

const parts = (v: string): number[] => v.split(".").map((n) => Number.parseInt(n, 10))
const atLeast = (version: string, target: string): boolean => {
  const [a, b] = [parts(version), parts(target)]
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return (a[i] ?? 0) > (b[i] ?? 0)
    }
  }
  return true
}

const fieldsOf = (tool: string): string[] => {
  const entry = KNOWLEDGE_MCP_TOOLS.find((t) => t.name === tool)
  if (entry === undefined) {
    return []
  }
  const json = z.toJSONSchema(entry.inputSchema as z.ZodType) as {
    properties?: Record<string, unknown>
  }
  return Object.keys(json.properties ?? {})
}

describe("pending contract items", () => {
  it("name real tools and real fields", () => {
    const names: string[] = KNOWLEDGE_MCP_TOOLS.map((t) => t.name)
    expect(names.length).toBeGreaterThan(0)
    expect(PENDING_TOOLS.filter((t) => !names.includes(t))).toEqual([])
    for (const [tool, fields] of Object.entries(PENDING_FIELDS)) {
      expect(
        fields.filter((f) => !fieldsOf(tool).includes(f)),
        `${tool}: ${fieldsOf(tool).join(", ")}`,
      ).toEqual([])
    }
  })

  it("are all served by the time the package reaches the promised release", () => {
    const left = [
      ...PENDING_TOOLS,
      ...Object.entries(PENDING_FIELDS).flatMap(([t, fs]) => fs.map((f) => `${t}.${f}`)),
    ]
    if (atLeast(PACKAGE_VERSION, PENDING_RELEASE)) {
      expect(left, `package ${PACKAGE_VERSION} ships unserved contract items`).toEqual([])
    } else {
      expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/u)
    }
  })

  it("compares versions numerically", () => {
    expect(atLeast("0.15.0", "0.15.0")).toBe(true)
    expect(atLeast("0.16.2", "0.15.0")).toBe(true)
    expect(atLeast("0.14.10", "0.15.0")).toBe(false)
    expect(atLeast("1.0.0", "0.15.0")).toBe(true)
  })

  it("flag only the fields a call actually sets", () => {
    expect(pendingFieldsIn("kl_search", { q: "x" })).toEqual([])
    expect(pendingFieldsIn("kl_search", { q: "x", mode: undefined })).toEqual([])
    expect(pendingFieldsIn("kl_search", { q: "x", mode: "history", period: {} })).toEqual([
      "mode",
      "period",
    ])
    expect(pendingFieldsIn("kl_get_material", { id: "x" })).toEqual([])
  })

  it("explain the refusal", () => {
    expect(pendingFieldsMessage("kl_search", ["mode"])).toBe(
      "kl_search: 'mode' is in contract 1.11.0 but not supported by this server yet",
    )
  })
})
