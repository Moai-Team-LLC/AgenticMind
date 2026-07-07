import { describe, expect, it } from "vitest"

import type {
  AppliedEdit,
  FixProposal,
  GateOutcome,
  RemediationJudge,
  RemediationJudgeResult,
} from "./index"

import {
  applyRemediation,
  approveRemediation,
  declineRemediation,
  gateProposal,
  invertEdit,
  openRemediation,
  revertRemediation,
} from "./index"
import { transition } from "./ledger"

const T = "2026-07-06T00:00:00.000Z"

const validProposal: FixProposal = {
  id: "fix:prompt-injection",
  findingId: "atk-1",
  target: "prompt",
  rationale: "harden trust rules",
  edits: [
    { path: "prompt.system", op: "modify", summary: "reinforce instruction/data separation" },
  ],
}

const forbiddenProposal: FixProposal = {
  id: "fix:escalate",
  findingId: "atk-2",
  target: "prompt",
  rationale: "should never pass",
  edits: [{ path: "identity.scopes", op: "modify", summary: "grant broader scope" }],
}

const structuralEdits: AppliedEdit[] = [
  { path: "prompt.system", op: "modify", before: "old prompt", after: "hardened prompt" },
]

const supportedJudge: RemediationJudge = async () => {
  return { verdict: "supported", rationale: "ok" }
}
const unsupportedJudge: RemediationJudge = async () => {
  return { verdict: "unsupported", rationale: "insufficient" }
}
const throwingJudge: RemediationJudge = async () => {
  throw new Error("model down")
}

describe("gateProposal", () => {
  it("refuses a forbidden proposal at the guard, without consulting the judge", async () => {
    const gate = await gateProposal(forbiddenProposal, supportedJudge)
    expect(gate.decision).toBe("guard_rejected")
    expect(gate.verdict).toBeNull()
  })

  it("rejects when the judge does not return 'supported'", async () => {
    const gate = await gateProposal(validProposal, unsupportedJudge)
    expect(gate.decision).toBe("judge_rejected")
    expect(gate.verdict?.verdict).toBe("unsupported")
  })

  it("fails closed when the judge throws", async () => {
    const gate = await gateProposal(validProposal, throwingJudge)
    expect(gate.decision).toBe("judge_rejected")
    expect(gate.verdict).toBeNull()
  })

  it("advances a supported, guard-passing fix to pending approval (never straight to apply)", async () => {
    const gate = await gateProposal(validProposal, supportedJudge)
    expect(gate.decision).toBe("pending_approval")
    expect(gate.verdict?.verdict).toBe("supported")
  })
})

describe("invertEdit", () => {
  it("inverts modify by swapping before/after", () => {
    expect(invertEdit({ path: "p", op: "modify", before: "a", after: "b" })).toEqual({
      path: "p",
      op: "modify",
      before: "b",
      after: "a",
    })
  })

  it("inverts add <-> remove", () => {
    expect(invertEdit({ path: "p", op: "add", before: null, after: "x" })).toEqual({
      path: "p",
      op: "remove",
      before: "x",
      after: null,
    })
  })
})

describe("L3 round-trip: judge -> HITL approve -> apply -> revert", () => {
  it("walks the full lifecycle and records every transition", async () => {
    const gate = await gateProposal(validProposal, supportedJudge)
    const opened = openRemediation(validProposal, gate, T)
    expect(opened.state).toBe("pending_approval")

    const approved = approveRemediation(opened, "alex", T)
    expect(approved.isOk()).toBe(true)
    const approvedEntry = approved._unsafeUnwrap()
    expect(approvedEntry.state).toBe("approved")

    const applied = applyRemediation(approvedEntry, structuralEdits, T)
    expect(applied.isOk()).toBe(true)
    const appliedEntry = applied._unsafeUnwrap()
    expect(appliedEntry.state).toBe("applied")
    expect(appliedEntry.edits).toEqual(structuralEdits)

    const reverted = revertRemediation(appliedEntry, T)
    expect(reverted.isOk()).toBe(true)
    const revertedEntry = reverted._unsafeUnwrap()
    expect(revertedEntry.state).toBe("reverted")
    expect(revertedEntry.history.map((h) => h.to)).toEqual([
      "pending_approval",
      "approved",
      "applied",
      "reverted",
    ])
  })
})

describe("L3 fail-closed invariants", () => {
  it("cannot apply before HITL approval (illegal transition)", async () => {
    const gate = await gateProposal(validProposal, supportedJudge)
    const pending = openRemediation(validProposal, gate, T)
    const result = applyRemediation(pending, structuralEdits, T)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("transition")
  })

  it("re-guards concrete edits at apply time — a forbidden edit is refused even after approval", async () => {
    const gate = await gateProposal(validProposal, supportedJudge)
    const approved = approveRemediation(
      openRemediation(validProposal, gate, T),
      "alex",
      T,
    )._unsafeUnwrap()
    const forbiddenEdits: AppliedEdit[] = [
      { path: "manifest.tools[0].sideEffect", op: "modify", before: "a", after: "b" },
    ]
    const result = applyRemediation(approved, forbiddenEdits, T)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("guard")
  })

  it("cannot revert an entry that was never applied", async () => {
    const gate = await gateProposal(validProposal, supportedJudge)
    const approved = approveRemediation(
      openRemediation(validProposal, gate, T),
      "alex",
      T,
    )._unsafeUnwrap()
    const result = revertRemediation(approved, T)
    expect(result.isErr()).toBe(true)
  })

  it("cannot approve a declined remediation", async () => {
    const gate = await gateProposal(validProposal, supportedJudge)
    const declined = declineRemediation(
      openRemediation(validProposal, gate, T),
      "alex",
      T,
    )._unsafeUnwrap()
    expect(declined.state).toBe("declined")
    expect(approveRemediation(declined, "alex", T).isErr()).toBe(true)
  })
})

describe("L3 hardening (adversarial-review fixes)", () => {
  it("the state machine refuses a pending -> approved caused by a non-hitl actor", async () => {
    const gate = await gateProposal(validProposal, supportedJudge)
    const pending = openRemediation(validProposal, gate, T)
    const forged = transition(pending, { to: "approved", actor: "system:auto", note: "", at: T })
    expect(forged.isErr()).toBe(true)
  })

  it("apply refuses a hand-forged 'approved' entry with no HITL approval on record", async () => {
    const gate = await gateProposal(validProposal, supportedJudge)
    const forgedApproved = {
      ...openRemediation(validProposal, gate, T),
      state: "approved" as const,
    }
    const result = applyRemediation(forgedApproved, structuralEdits, T)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().kind).toBe("transition")
  })

  it("fails closed when the judge resolves a malformed (non-object) verdict", async () => {
    const badJudge = (async () => null) as unknown as RemediationJudge
    const gate = await gateProposal(validProposal, badJudge)
    expect(gate.decision).toBe("judge_rejected")
    expect(gate.verdict).toBeNull()
  })

  it("records a frozen deep copy of applied edits — no caller alias can rewrite the ledger", async () => {
    const gate = await gateProposal(validProposal, supportedJudge)
    const approved = approveRemediation(
      openRemediation(validProposal, gate, T),
      "alex",
      T,
    )._unsafeUnwrap()
    const callerEdits: AppliedEdit[] = [
      { path: "prompt.system", op: "modify", before: "a", after: "b" },
    ]
    const applied = applyRemediation(approved, callerEdits, T)._unsafeUnwrap()
    expect(applied.edits).not.toBe(callerEdits)
    expect(Object.isFrozen(applied.edits)).toBe(true)
    const firstEdit = callerEdits[0]
    if (firstEdit) {
      firstEdit.after = "MUTATED"
    }
    expect(applied.edits[0]?.after).toBe("b")
  })

  it("freezes the opened entry and deep-copies the verdict — the recorded decision can't be rewritten", () => {
    const heldVerdict = { verdict: "supported" as const, rationale: "ok" }
    const gate: GateOutcome = {
      decision: "pending_approval",
      guard: { allowed: true, violations: [] },
      verdict: heldVerdict,
      reason: "test",
    }
    const entry = openRemediation(validProposal, gate, T)
    expect(Object.isFrozen(entry)).toBe(true)
    expect(entry.verdict).not.toBe(heldVerdict)
    heldVerdict.rationale = "TAMPERED"
    expect(entry.verdict?.rationale).toBe("ok")
  })

  it("deep-freezes verdict content an untrusted judge may nest (not just top-level)", () => {
    const nested = { audit: "orig" }
    const gate: GateOutcome = {
      decision: "pending_approval",
      guard: { allowed: true, violations: [] },
      verdict: {
        verdict: "supported",
        rationale: "ok",
        nested,
      } as unknown as RemediationJudgeResult,
      reason: "t",
    }
    const entry = openRemediation(validProposal, gate, T)
    const recorded = entry.verdict as unknown as { nested: { audit: string } }
    expect(Object.isFrozen(recorded.nested)).toBe(true)
  })
})
