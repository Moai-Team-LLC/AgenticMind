import type { Catalog, ControlEntry } from "@agenticmind/assurance/catalog/schema"
import type { OtelGenAiSpan } from "@agenticmind/assurance/evidence/otel"

import { loadCatalog } from "@agenticmind/assurance/catalog/load"
import { computeCoverage } from "@agenticmind/assurance/evidence/collect"
import { collectFromOtelSpans, isGenAiSpan } from "@agenticmind/assurance/evidence/otel"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"

import type { CoreReport } from "./ingest"

import { ingestCoreReport } from "./ingest"
import { scoreControl } from "./score"

const AT = "2026-07-04T00:00:00Z"
const spans: OtelGenAiSpan[] = [
  { name: "chat", attributes: { "gen_ai.system": "openai", "gen_ai.request.model": "gpt-4o" } },
  { name: "tool", attributes: { "gen_ai.operation.name": "execute_tool" } },
  { name: "db", attributes: { "db.system": "postgres" } }, // not a GenAI span
]

let catalog: Catalog
let emptyReport: CoreReport
beforeAll(() => {
  const c = loadCatalog(
    fileURLToPath(new URL("../../catalog/aal-control-catalog.yaml", import.meta.url)),
  )
  if (c.isErr()) {
    throw new Error("catalog load failed")
  }
  catalog = c.value
  const r = ingestCoreReport({
    schemaVersion: "aal-core-report/0.1",
    target: "otel-only-target",
    criticalCount: 0,
    findings: [],
    attacks: [],
    flows: [],
  })
  if (r.isErr()) {
    throw new Error("report ingest failed")
  }
  emptyReport = r.value
})

const control = (id: string): ControlEntry => {
  const c = catalog.controls.find((x) => x.id === id)
  if (!c) {
    throw new Error(`control ${id} missing`)
  }
  return c
}

describe("generic (OTel) evidence — FR-9.2 honest degradation", () => {
  it("ingests only GenAI spans and marks evidence generic", () => {
    expect(spans.filter((s) => isGenAiSpan(s))).toHaveLength(2)
    const ev = collectFromOtelSpans(spans, AT)
    expect(ev.length).toBe(2)
    expect(ev.every((e) => e.collector === "generic")).toBe(true)
  })

  it("does NOT score a native-required control GREEN on generic evidence (degraded → YELLOW)", () => {
    const ev = collectFromOtelSpans(spans, AT)
    // AAL-ACC-01 requires native evidence; generic is weaker → not fully verified.
    const s = scoreControl(control("AAL-ACC-01"), emptyReport, ev)
    expect(s.status).toBe("yellow")
    expect(s.rationale.toLowerCase()).toContain("degraded")
  })

  it("scores a generic-required control GREEN on generic evidence", () => {
    const ev = collectFromOtelSpans(spans, AT)
    // AAL-REL-03's required collector IS generic, so generic evidence suffices.
    expect(control("AAL-REL-03").evidence_requirement.collector).toBe("generic")
    expect(scoreControl(control("AAL-REL-03"), emptyReport, ev).status).toBe("green")
  })

  it("coverage reflects reality: generic present, native zero for these controls", () => {
    const ev = collectFromOtelSpans(spans, AT)
    const cov = computeCoverage(["AAL-ACC-01", "AAL-REL-03"], ev)
    expect(cov.native).toBe(0)
    expect(cov.generic).toBe(2)
    expect(cov.ratio).toBe(0)
  })
})
