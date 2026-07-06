import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"

import { loadCatalog, type Catalog } from "../catalog"
import { collectNative, type EngineRows, type EvidenceRecord } from "../evidence"
import { ingestCoreJson, type CoreReport } from "./ingest"
import { scoreCatalog, scoreControl } from "./score"

const url = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
const readJson = (name: string): CoreReport => {
  const r = ingestCoreJson(readFileSync(url(`../../fixtures/${name}`), "utf8"))
  if (r.isErr()) throw new Error(`ingest ${name} failed: ${r.error.message}`)
  return r.value
}

const AT = "2026-07-03T00:00:00Z"
const engineRows: EngineRows = {
  guardEvents: [
    { id: "ge1", tool: "kl_ask", reason: "injection", inputHash: "h1", createdAt: AT },
    { id: "ge2", tool: "kl_ask", reason: "pii_redacted", inputHash: "h2", createdAt: AT },
  ],
  askTelemetry: [{ id: "at1", questionHash: "q1", model: "m", citationCount: 2, createdAt: AT }],
  mcpTokens: [
    { jti: "t1", actorType: "agent", scopes: ["kl:read"], expiresAt: AT, revokedAt: null },
  ],
  mcpToolsLockHash: "deadbeefcafebabe0000",
}

let catalog: Catalog
let evidence: EvidenceRecord[]
beforeAll(() => {
  const c = loadCatalog(url("../../catalog/aal-control-catalog.yaml"))
  if (c.isErr()) throw new Error("catalog load failed")
  catalog = c.value
  evidence = collectNative(engineRows, AT)
})

const controlOf = (id: string) => {
  const c = catalog.controls.find((x) => x.id === id)
  if (!c) throw new Error(`control ${id} missing`)
  return c
}

describe("gap-analysis scoring", () => {
  it("scores a control RED when a mapped Plane-A attack succeeded", () => {
    const report = readJson("reference-agent.json")
    // AAL-SEC-01 has injection evidence AND a failing injection test → RED (tests beat evidence).
    const s = scoreControl(controlOf("AAL-SEC-01"), report, evidence)
    expect(s.status).toBe("red")
    expect(s.drivingFindings.length).toBeGreaterThan(0)
  })

  it("scores GREEN only with evidence AND no failing/required-unpassed test", () => {
    const report = readJson("reference-agent.json")
    // AAL-ACC-01 requires no Plane-A test and has ask-telemetry evidence → GREEN.
    expect(scoreControl(controlOf("AAL-ACC-01"), report, evidence).status).toBe("green")
    expect(scoreControl(controlOf("AAL-ACC-03"), report, evidence).status).toBe("green")
  })

  it("scores YELLOW on absence of evidence (never Green without it)", () => {
    const report = readJson("reference-agent.json")
    // AAL-DAP-03 (data-use policy) is manual, uncollected, no test → YELLOW.
    expect(scoreControl(controlOf("AAL-DAP-03"), report, evidence).status).toBe("yellow")
    // A control with evidence but an unrun required test is not_verified → YELLOW.
    expect(scoreControl(controlOf("AAL-SEC-04"), report, evidence).status).toBe("yellow")
  })

  it("FR-8.2: a failing test forces RED even when the manifest declares a mitigation", () => {
    // The mitigated manifest breaks the trifecta legs (flows mitigated), but the SAME vulnerable
    // agent still exfiltrates under the trifecta-exploit attack — so the control stays RED.
    const mitigated = readJson("mitigated-agent.json")
    const trifectaAttack = mitigated.attacks.find((a) => a.attackClass === "trifecta-exploit")
    expect(trifectaAttack?.outcome).toBe("succeeded")
    expect(mitigated.flows.every((f) => f.mitigated)).toBe(true)
    expect(scoreControl(controlOf("AAL-SEC-07"), mitigated, evidence).status).toBe("red")
  })

  it("produces a full G/Y/R spread over the catalog", () => {
    const report = readJson("reference-agent.json")
    const statuses = scoreCatalog(catalog, report, evidence)
    const set = new Set(statuses.map((s) => s.status))
    expect(set.has("red")).toBe(true)
    expect(set.has("green")).toBe(true)
    expect(set.has("yellow")).toBe(true)
    expect(statuses.length).toBe(catalog.controls.length)
  })
})
