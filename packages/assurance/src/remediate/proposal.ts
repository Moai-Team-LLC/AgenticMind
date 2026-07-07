/**
 * Remediation proposal model (FR-11.1/11.2).
 *
 * The autonomy ladder turns a finding into a *proposed* structural fix. The hard invariant: a
 * proposal may only edit **structural configuration** — prompts, context, few-shots, capability
 * manifests, and declared mitigations. It must NEVER touch a side-effecting tool, a permission
 * grant, or a trust boundary (the Cycle of Trust). `guard.ts` enforces this on the concrete edit
 * paths, not on the declared `target` (a proposal cannot lie its way past the gate).
 *
 * Edits are payload-free: a `summary` of the change, never a raw secret or attack payload.
 */

/** The only surfaces autonomous remediation is ever allowed to modify. */
export type StructuralTarget =
  | "prompt"
  | "context"
  | "few-shot"
  | "capability-manifest"
  | "declared-mitigation"

export type ProposedEdit = {
  /** Logical path being edited, e.g. `prompt.system` or `manifest.declaredMitigations`. */
  path: string
  op: "add" | "modify" | "remove"
  /** Payload-free description of the change. */
  summary: string
}

export type FixProposal = {
  id: string
  /** The AAL Core finding / attack this addresses. */
  findingId: string
  target: StructuralTarget
  rationale: string
  edits: ProposedEdit[]
}

export type GuardViolation = {
  path: string
  reason: string
}

export type GuardResult = {
  allowed: boolean
  violations: GuardViolation[]
}
