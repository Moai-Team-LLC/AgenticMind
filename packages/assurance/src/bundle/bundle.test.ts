import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"

import { loadCatalog, type Catalog } from "../catalog"
import { collectNative, type EngineRows, type EvidenceRecord } from "../evidence"
import { ingestCoreJson } from "../gap"
import { assembleBundle, bundleToJson, bundleToMarkdown } from "./index"

const url = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
const AT = "2026-07-03T00:00:00Z"
const rows: EngineRows = {
  guardEvents: [{ id: "ge1", tool: "kl_ask", reason: "injection", inputHash: "h1", createdAt: AT }],
  askTelemetry: [{ id: "at1", questionHash: "q1", model: "m", citationCount: 2, createdAt: AT }],
}

let catalog: Catalog
let evidence: EvidenceRecord[]
beforeAll(() => {
  const c = loadCatalog(url("../../catalog/aal-control-catalog.yaml"))
  if (c.isErr()) throw new Error("catalog load failed")
  catalog = c.value
  evidence = collectNative(rows, AT)
})

const report = () => {
  const r = ingestCoreJson(readFileSync(url("../../fixtures/reference-agent.json"), "utf8"))
  if (r.isErr()) throw new Error("ingest failed")
  return r.value
}

describe("auditor bundle", () => {
  it("assembles a G/Y/R bundle with remediation and coverage", () => {
    const bundle = assembleBundle(catalog, report(), evidence)
    expect(bundle.schemaVersion).toBe("aal-evidence-bundle/0.1")
    expect(bundle.controls.length).toBe(catalog.controls.length)
    expect(bundle.statusCounts.red).toBeGreaterThan(0)
    expect(bundle.remediation.length).toBeGreaterThan(0)
    // Remediation is prioritized: red before yellow.
    const firstYellow = bundle.remediation.findIndex((r) => r.status === "yellow")
    const lastRed = bundle.remediation.map((r) => r.status).lastIndexOf("red")
    if (firstYellow !== -1 && lastRed !== -1) expect(lastRed).toBeLessThan(firstYellow)
  })

  it("renders JSON and Markdown; coverage present; payload-free", () => {
    const bundle = assembleBundle(catalog, report(), evidence)
    const json = JSON.parse(bundleToJson(bundle))
    expect(json.coverage.total).toBe(catalog.controls.length)

    const md = bundleToMarkdown(bundle)
    expect(md).toContain("Coverage:")
    expect(md).toContain("Auditor Bundle")
    expect(md).not.toContain("attacker.example")
    expect(md).not.toContain("alice@corp.test")
  })

  it("can filter to the v1.0 core scope (Security + Accountability)", () => {
    const bundle = assembleBundle(catalog, report(), evidence, { scope: "core" })
    expect(bundle.controls.every((c) => c.domain === "B" || c.domain === "E")).toBe(true)
  })
})
