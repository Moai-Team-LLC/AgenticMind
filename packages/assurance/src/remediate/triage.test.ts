import type { CoreReport } from "@agenticmind/assurance/gap/ingest"

import { ingestCoreJson } from "@agenticmind/assurance/gap/ingest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { enforceCycleOfTrust, triageFindings } from "./index"

const report = (): CoreReport => {
  const r = ingestCoreJson(
    readFileSync(
      fileURLToPath(new URL("../../fixtures/reference-agent.json", import.meta.url)),
      "utf8",
    ),
  )
  if (r.isErr()) {
    throw new Error("ingest failed")
  }
  return r.value
}

describe("L2 triage", () => {
  it("proposes a structural fix for each failed attack class", () => {
    const proposals = triageFindings(report())
    expect(proposals.length).toBeGreaterThan(0)
    expect(proposals.every((p) => p.edits.length > 0)).toBe(true)
  })

  it("every triage proposal passes the Cycle-of-Trust guard (invariant)", () => {
    for (const p of triageFindings(report())) {
      expect(enforceCycleOfTrust(p).allowed, `proposal ${p.id} must be structural-only`).toBe(true)
    }
  })

  it("never targets a tool / permission / trust-boundary path", () => {
    for (const p of triageFindings(report())) {
      for (const e of p.edits) {
        expect(e.path.toLowerCase()).not.toMatch(/\btool|permission|scope|identity|egress|\bexec/)
      }
    }
  })

  it("proposes no fixes when nothing failed", () => {
    const clean = ingestCoreJson(
      JSON.stringify({
        schemaVersion: "aal-core-report/0.1",
        target: "t",
        criticalCount: 0,
        findings: [],
        attacks: [],
        flows: [],
      }),
    )
    if (clean.isErr()) {
      throw new Error("ingest failed")
    }
    expect(triageFindings(clean.value)).toHaveLength(0)
  })
})
