import { describe, expect, it } from "vitest"

import type { FixProposal, ProposedEdit } from "./index"

import { enforceCycleOfTrust } from "./index"

const proposal = (edits: ProposedEdit[]): FixProposal => {
  return {
    id: "p",
    findingId: "f",
    target: "prompt",
    rationale: "",
    edits,
  }
}

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

  it(
    String.raw`REFUSES camelCase/glued forbidden tokens under an allowed prefix (tokenized, not \b)`,
    () => {
      const bypasses = [
        "prompt.allowedTools",
        "prompt.grantedScopes",
        "context.toolPermissions",
        "context.egressAllowlist",
        "prompt.trustBoundary",
        "prompt.authToken",
        "declaredMitigationTool",
        "manifest.sideEffectPolicy",
      ]
      for (const path of bypasses) {
        const r = enforceCycleOfTrust(proposal([{ path, op: "modify", summary: "x" }]))
        expect(r.allowed, `${path} must be refused`).toBe(false)
      }
    },
  )

  it("still allows a structural path whose word merely contains a forbidden substring", () => {
    // "trusted" must not trip the "trust" token — this is a real L2 fix path (tool-shadowing).
    const r = enforceCycleOfTrust(
      proposal([
        { path: "context.trusted-descriptions", op: "modify", summary: "pin descriptions" },
      ]),
    )
    expect(r.allowed).toBe(true)
  })

  it("REFUSES dangerous surfaces a denylist would miss (allowlist is fail-closed)", () => {
    const refused = [
      "prompt.autoApprove", // attacks the HITL approval gate itself
      "context.bypassApproval",
      "manifest.capabilities",
      "manifest.entitlements",
      "context.privilegeLevel",
      "context.superuser",
      "prompt.rootAccess",
      "context.mcpServers",
      "prompt.shellCommand",
      "context.oauthClientSecret",
      "context.privateKey",
      "prompt.password",
      "prompt.perm",
      "context.cap",
      "manifest.entitlement",
      "prompt.privilege",
    ]
    for (const path of refused) {
      const r = enforceCycleOfTrust(proposal([{ path, op: "modify", summary: "x" }]))
      expect(r.allowed, `${path} must be refused`).toBe(false)
    }
  })

  it("allows exactly the structural surfaces L2 triage emits", () => {
    const allowed = [
      "prompt.system",
      "manifest.declaredMitigations",
      "context.trusted-descriptions",
    ]
    for (const path of allowed) {
      const r = enforceCycleOfTrust(proposal([{ path, op: "modify", summary: "structural" }]))
      expect(r.allowed, `${path} must be allowed`).toBe(true)
    }
  })
})
