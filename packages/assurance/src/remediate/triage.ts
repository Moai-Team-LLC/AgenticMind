/**
 * L2 triage — propose-only (FR-11.1).
 *
 * Clusters a scan's failing attacks by class and proposes a STRUCTURAL fix for each — always to a
 * prompt / context / manifest / declared-mitigation, never to a tool or permission. Note the
 * tool-misuse fixes: they strengthen the *prompt/guardrails*, never the tool itself (Cycle of
 * Trust). Every proposal is self-checked through the guard before it is emitted, so triage can
 * never produce a forbidden edit even if a mapping is wrong.
 *
 * This is L2 (propose only). L3 (judge gate → HITL approval → apply → revert) reuses the engine's
 * judge and is the in-monorepo follow-up.
 */
import type { CoreReport } from "../gap/ingest"
import type { FixProposal, ProposedEdit, StructuralTarget } from "./proposal"

import { enforceCycleOfTrust } from "./guard"

interface ClassFix {
  target: StructuralTarget
  path: string
  op: ProposedEdit["op"]
  summary: string
  rationale: string
}

const CLASS_FIX: Record<string, ClassFix> = {
  "prompt-injection": {
    target: "prompt",
    path: "prompt.system",
    op: "modify",
    summary: "reinforce instruction/data separation; treat all retrieved content as untrusted",
    rationale: "The agent adopted an injected objective; harden the system prompt's trust rules.",
  },
  "indirect-injection": {
    target: "declared-mitigation",
    path: "manifest.declaredMitigations",
    op: "add",
    summary:
      "declare a quarantine of untrusted retrieved/tool-output content from the instruction channel",
    rationale:
      "Injected content in retrieval reached the instruction channel; declare its quarantine.",
  },
  "data-exfil": {
    target: "declared-mitigation",
    path: "manifest.declaredMitigations",
    op: "add",
    summary: "declare an external-egress allow-list + out-of-band approval mitigation",
    rationale: "Private data could be exfiltrated; break the egress leg with a declared control.",
  },
  "trifecta-exploit": {
    target: "declared-mitigation",
    path: "manifest.declaredMitigations",
    op: "add",
    summary: "break a trifecta leg via a declared egress gate or ingress quarantine",
    rationale: "A lethal-trifecta path was exploited; declare a leg-breaking mitigation.",
  },
  "config-rce": {
    target: "declared-mitigation",
    path: "manifest.declaredMitigations",
    op: "add",
    summary: "declare a code-execution sandbox with egress denied by default",
    rationale: "Attacker-controlled input reached code execution; declare a sandbox mitigation.",
  },
  "tool-poisoning": {
    target: "prompt",
    path: "prompt.system",
    op: "modify",
    summary:
      "add tool-use guardrails to the system prompt (validate args, require approval on high-impact)",
    rationale:
      "A tool was driven into misuse; harden the prompt's tool-use rules (not the tool itself).",
  },
  "tool-shadowing": {
    // Path avoids the word "tool" so the (correctly strict) guard does not reject a context edit.
    target: "context",
    path: "context.trusted-descriptions",
    op: "modify",
    summary: "pin trusted tool descriptions in context so a shadow tool cannot override them",
    rationale: "A shadow tool overrode a real one; anchor the trusted descriptions in context.",
  },
  "mcp-rug-pull": {
    target: "declared-mitigation",
    path: "manifest.declaredMitigations",
    op: "add",
    summary: "declare hash-pinning of MCP tool definitions with fail-closed drift detection",
    rationale: "Tool definitions could be swapped after approval; declare hash-pinning.",
  },
}

/** L2: propose structural fixes for the classes that failed. Every proposal passes the guard. */
export function triageFindings(report: CoreReport): FixProposal[] {
  const failedClasses = new Map<string, string[]>()
  for (const a of report.attacks) {
    if (a.outcome !== "succeeded" && !a.refuseButFire) continue
    const ids = failedClasses.get(a.attackClass) ?? []
    ids.push(a.attackId)
    failedClasses.set(a.attackClass, ids)
  }

  const proposals: FixProposal[] = []
  for (const [cls, attackIds] of failedClasses) {
    const fix = CLASS_FIX[cls]
    if (!fix) continue
    const proposal: FixProposal = {
      id: `fix:${cls}`,
      findingId: attackIds.join(","),
      target: fix.target,
      rationale: fix.rationale,
      edits: [{ path: fix.path, op: fix.op, summary: fix.summary }],
    }
    // Self-check: never emit a proposal the Cycle-of-Trust guard would reject. NB: the guard is a
    // fail-closed allowlist (guard.ts `ALLOWED_PATHS`) — a new CLASS_FIX whose path is not allowlisted
    // is silently dropped here, so add its structural path to `ALLOWED_PATHS` when introducing one.
    if (enforceCycleOfTrust(proposal).allowed) proposals.push(proposal)
  }
  return proposals
}
