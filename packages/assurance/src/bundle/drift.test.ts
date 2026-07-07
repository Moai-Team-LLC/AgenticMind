import type { Catalog } from "@agenticmind/assurance/catalog/schema"
import type { EvidenceRecord } from "@agenticmind/assurance/evidence/schema"
import type { CoreAttack, CoreReport } from "@agenticmind/assurance/gap/ingest"

import { loadCatalog } from "@agenticmind/assurance/catalog/load"
import { collectNative } from "@agenticmind/assurance/evidence/collect"
import { ingestCoreReport } from "@agenticmind/assurance/gap/ingest"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"

import type { ControlSnapshot } from "./drift"

import { assembleBundle } from "./build"
import { diffBundles, evaluateDrift } from "./drift"

const AT = "2026-07-04T00:00:00Z"

const attack = (attackClass: string, outcome: CoreAttack["outcome"]): CoreAttack => {
  return {
    attackId: `${attackClass}-1`,
    attackClass,
    owasp: "ASI01",
    atlas: "AML.T0051",
    outcome,
    stability: { pass: outcome === "succeeded" ? 1 : 0, total: 1 },
    inputHash: "hash",
    refuseButFire: false,
  }
}

const report = (attacks: CoreAttack[]): CoreReport => {
  const r = ingestCoreReport({
    schemaVersion: "aal-core-report/0.1",
    target: "t",
    criticalCount: 0,
    findings: [],
    attacks,
    flows: [],
  })
  if (r.isErr()) {
    throw new Error("ingest failed")
  }
  return r.value
}

let catalog: Catalog
let evidence: EvidenceRecord[]
beforeAll(() => {
  const c = loadCatalog(
    fileURLToPath(new URL("../../catalog/aal-control-catalog.yaml", import.meta.url)),
  )
  if (c.isErr()) {
    throw new Error("catalog load failed")
  }
  catalog = c.value
  // Native injection evidence so AAL-SEC-01 can be GREEN when its test passes.
  evidence = collectNative(
    {
      guardEvents: [
        { id: "ge1", tool: "kl_ask", reason: "injection", inputHash: "h", createdAt: AT },
      ],
    },
    AT,
  )
})

describe("drift detection", () => {
  // AAL-SEC-01 is tested by prompt-injection + indirect-injection. Both contained → test passed.
  const passing = [
    attack("prompt-injection", "contained"),
    attack("indirect-injection", "contained"),
  ]
  const failing = [
    attack("prompt-injection", "succeeded"),
    attack("indirect-injection", "contained"),
  ]

  it("flags a green→red regression as critical drift", () => {
    const prev = assembleBundle(catalog, report(passing), evidence)
    const next = assembleBundle(catalog, report(failing), evidence)
    // Precondition: AAL-SEC-01 really was green, then red.
    expect(prev.controls.find((c) => c.controlId === "AAL-SEC-01")?.status).toBe("green")
    expect(next.controls.find((c) => c.controlId === "AAL-SEC-01")?.status).toBe("red")

    const drift = diffBundles(prev, next)
    expect(drift.hasCriticalDrift).toBe(true)
    expect(
      drift.regressions.some(
        (r) => r.controlId === "AAL-SEC-01" && r.from === "green" && r.to === "red",
      ),
    ).toBe(true)
    expect(drift.added).toEqual([])
    expect(drift.removed).toEqual([])
  })

  it("reports the reverse diff as an improvement, not drift", () => {
    const prev = assembleBundle(catalog, report(failing), evidence)
    const next = assembleBundle(catalog, report(passing), evidence)
    const drift = diffBundles(prev, next)
    expect(drift.hasCriticalDrift).toBe(false)
    expect(drift.improvements.some((r) => r.controlId === "AAL-SEC-01" && r.to === "green")).toBe(
      true,
    )
  })

  it("no drift when nothing changed", () => {
    const b = assembleBundle(catalog, report(passing), evidence)
    const drift = diffBundles(b, b)
    expect(drift.regressions).toEqual([])
    expect(drift.improvements).toEqual([])
  })
})

describe("evaluateDrift (continuous assurance)", () => {
  const snap = (entries: [string, ControlSnapshot["status"]][]): ControlSnapshot[] =>
    entries.map(([controlId, status]) => {
      return { controlId, status }
    })

  it("treats the first run (no prior) as a baseline — no drift, no alert", () => {
    const { report: rep, alert } = evaluateDrift(null, snap([["A", "green"]]))
    expect(rep).toBeNull()
    expect(alert).toBeNull()
  })

  it("does not alert when nothing regressed (an improvement is not drift)", () => {
    const prev = snap([
      ["A", "green"],
      ["B", "yellow"],
    ])
    const next = snap([
      ["A", "green"],
      ["B", "green"],
    ])
    const { report: rep, alert } = evaluateDrift(prev, next)
    expect(rep?.regressions).toEqual([])
    expect(alert).toBeNull()
  })

  it("warns on a non-critical regression (yellow→red)", () => {
    const { alert } = evaluateDrift(snap([["A", "yellow"]]), snap([["A", "red"]]))
    expect(alert?.severity).toBe("warning")
    expect(alert?.regressions[0]?.controlId).toBe("A")
  })

  it("escalates to critical when a control falls green→red", () => {
    const { report: rep, alert } = evaluateDrift(snap([["A", "green"]]), snap([["A", "red"]]))
    expect(rep?.hasCriticalDrift).toBe(true)
    expect(alert?.severity).toBe("critical")
  })
})
