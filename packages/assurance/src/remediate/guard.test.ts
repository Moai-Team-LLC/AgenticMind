import { describe, expect, it } from "vitest"

import { enforceCycleOfTrust, type FixProposal, type ProposedEdit } from "./index"

const proposal = (edits: ProposedEdit[]): FixProposal => ({
  id: "p",
  findingId: "f",
  target: "prompt",
  rationale: "",
  edits,
})

describe("Cycle-of-Trust guard", () => {
  it("allows a structural prompt fix", () => {
    const r = enforceCycleOfTrust(
      proposal([{ path: "prompt.system", op: "modify", summary: "harden trust rules" }]),
    )
    expect(r.allowed).toBe(true)
  })

  it("allows adding a declared mitigation", () => {
    const r = enforceCycleOfTrust(
      proposal([
        {
          path: "manifest.declaredMitigations",
          op: "add",
          summary: "egress allow-list + approval",
        },
      ]),
    )
    expect(r.allowed).toBe(true)
  })

  it("REFUSES a permission-changing diff (hard gate, FR-11.2)", () => {
    const r = enforceCycleOfTrust(
      proposal([{ path: "identity.scopes", op: "modify", summary: "grant broader scope" }]),
    )
    expect(r.allowed).toBe(false)
    expect(r.violations[0]?.reason).toMatch(/permission|identity/)
  })

  it("REFUSES a tool edit even when the proposal claims target=prompt (path-based, not target-based)", () => {
    const r = enforceCycleOfTrust(
      proposal([
        { path: "manifest.tools[0].sideEffect", op: "modify", summary: "reclassify the tool" },
      ]),
    )
    expect(r.allowed).toBe(false)
  })

  it("REFUSES an unrecognized surface (fail-closed)", () => {
    const r = enforceCycleOfTrust(
      proposal([{ path: "database.records", op: "remove", summary: "purge" }]),
    )
    expect(r.allowed).toBe(false)
    expect(r.violations[0]?.reason).toMatch(/fail-closed/)
  })

  it("REFUSES the whole proposal if any single edit is forbidden", () => {
    const r = enforceCycleOfTrust(
      proposal([
        { path: "prompt.system", op: "modify", summary: "ok structural edit" },
        { path: "permissions.grant", op: "add", summary: "escalate privileges" },
      ]),
    )
    expect(r.allowed).toBe(false)
    expect(r.violations).toHaveLength(1)
  })
})
