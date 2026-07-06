import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  byDomain,
  byScope,
  loadCatalog,
  parseCatalog,
  referencedAsi,
  requiringPlaneATest,
} from "./index"

const catalogPath = fileURLToPath(
  new URL("../../catalog/aal-control-catalog.yaml", import.meta.url),
)

describe("control catalog", () => {
  it("loads and validates the shipped catalog", () => {
    const result = loadCatalog(catalogPath)
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.controls.length).toBeGreaterThan(10)
      expect(result.value.version).toMatch(/\d/)
    }
  })

  it("v1.0 core scope is Security + Accountability", () => {
    const r = loadCatalog(catalogPath)
    if (!r.isOk()) throw new Error("catalog load failed")
    const core = byScope(r.value, "core")
    const domains = new Set(core.map((c) => c.aiuc1_domain))
    expect(domains).toEqual(new Set(["B", "E"]))
  })

  it("Security domain has the strongest native coverage", () => {
    const r = loadCatalog(catalogPath)
    if (!r.isOk()) throw new Error("catalog load failed")
    const security = byDomain(r.value, "B")
    expect(security.length).toBeGreaterThanOrEqual(5)
  })

  it("only references the fixed ASI01–ASI10 set", () => {
    const r = loadCatalog(catalogPath)
    if (!r.isOk()) throw new Error("catalog load failed")
    for (const asi of referencedAsi(r.value)) expect(asi).toMatch(/^ASI0[1-9]$|^ASI10$/)
    expect(requiringPlaneATest(r.value).length).toBeGreaterThan(0)
  })

  it("rejects a control with a bogus OWASP ASI id (fail-closed)", () => {
    const result = parseCatalog({
      version: "0.1.0",
      controls: [
        {
          id: "X",
          title: "x",
          scope: "core",
          aiuc1_domain: "B",
          owasp_asi: ["ASI99"],
          intent: "x",
          evidence_requirement: { artifact: "a", collector: "native" },
          test_requirement: { attack_class: [], plane_a: false },
          status_rule: "x",
        },
      ],
    })
    expect(result.isErr()).toBe(true)
  })
})
