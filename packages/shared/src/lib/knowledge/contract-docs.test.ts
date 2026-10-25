// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import { AUDIT_WRITE_SCOPE } from "@agenticmind/shared/lib/audit/hook-event"
import { ANSWER_STATUSES } from "@agenticmind/shared/lib/knowledge/answer-status"
import { KNOWLEDGE_SCOPES, TOOL_SCOPE } from "@agenticmind/shared/lib/knowledge/mcp-scopes"
import {
  KNOWLEDGE_MCP_TOOLS,
  MCP_CONTRACT_VERSION,
} from "@agenticmind/shared/lib/knowledge/mcp-tools"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as z from "zod"

/**
 * The published contract (CONTRACT.md) and the security model must describe the
 * code, not a past version of it. Everything compared here is derived from the
 * code — the tool registry, the scope list, the status list — so a new tool,
 * field, scope or status fails this test until the documents mention it.
 */

const read = (rel: string): string =>
  readFileSync(new URL(`../../../../../${rel}`, import.meta.url), "utf8")

const CONTRACT = read("CONTRACT.md")
const SECURITY = read("docs/security-model.md")

type Row = { scope: string; required: string[]; optional: string[] }

const fieldsOf = (cell: string): string[] =>
  [...cell.matchAll(/`([A-Za-z_]+)`/gu)].map((m) => m[1] ?? "").toSorted()

/** Parses the Tools table rows of CONTRACT.md. */
const contractRows = (): Map<string, Row> => {
  const rows = new Map<string, Row>()
  for (const line of CONTRACT.split("\n")) {
    const m = /^\| `([a-z_]+)` \| `([a-z:]+)` \| (.*) \| (.*) \|$/u.exec(line)
    if (m !== null) {
      rows.set(m[1] ?? "", {
        scope: m[2] ?? "",
        required: fieldsOf(m[3] ?? ""),
        optional: fieldsOf(m[4] ?? ""),
      })
    }
  }
  return rows
}

const expectedRow = (tool: (typeof KNOWLEDGE_MCP_TOOLS)[number]): Row => {
  const json = z.toJSONSchema(tool.inputSchema as z.ZodType) as {
    properties?: Record<string, unknown>
    required?: string[]
  }
  const all = Object.keys(json.properties ?? {})
  const required = (json.required ?? []).toSorted()
  return {
    scope: TOOL_SCOPE[tool.name] ?? "(no TOOL_SCOPE entry)",
    required,
    optional: all.filter((f) => !required.includes(f)).toSorted(),
  }
}

describe("CONTRACT.md matches the code", () => {
  it("states the current contract version", () => {
    expect(CONTRACT).toContain(`**Current version: \`${MCP_CONTRACT_VERSION}\`**`)
  })

  it("has one row per registered tool, with its scope and input fields", () => {
    const rows = contractRows()
    expect(rows.size, `rows: ${[...rows.keys()].join(", ")}`).toBeGreaterThan(0)
    const expected = Object.fromEntries(KNOWLEDGE_MCP_TOOLS.map((t) => [t.name, expectedRow(t)]))
    expect(Object.fromEntries(rows)).toEqual(expected)
  })

  it("names every answer status", () => {
    const missing = ANSWER_STATUSES.filter((s) => !CONTRACT.includes(`\`${s}\``))
    expect(missing).toEqual([])
  })
})

describe("documents name every scope the code grants", () => {
  const scopes = [...KNOWLEDGE_SCOPES, AUDIT_WRITE_SCOPE]

  it.each([
    ["CONTRACT.md", CONTRACT],
    ["docs/security-model.md", SECURITY],
  ])("%s", (_name, text) => {
    expect(scopes.length).toBeGreaterThan(0)
    expect(scopes.filter((s) => !text.includes(`\`${s}\``))).toEqual([])
  })
})
