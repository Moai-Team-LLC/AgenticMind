/**
 * Ingest AAL Core's structured JSON report (FR-8.1 input).
 *
 * Validates the `aal scan --json` output and exposes the parts the gap engine scores against:
 * per-attack outcomes, toxic flows, and findings. Fail-closed: a malformed report is a typed
 * error, never a partial ingest.
 */
import { err, ok, type Result } from "neverthrow"
import { z } from "zod"

export const CoreOutcome = z.enum(["succeeded", "contained", "not_verified"])
export type CoreOutcome = z.infer<typeof CoreOutcome>

export const CoreAttack = z.object({
  attackId: z.string(),
  attackClass: z.string(),
  owasp: z.string(),
  atlas: z.string(),
  outcome: CoreOutcome,
  stability: z.object({ pass: z.number(), total: z.number() }),
  inputHash: z.string(),
  refuseButFire: z.boolean().default(false),
})
export type CoreAttack = z.infer<typeof CoreAttack>

export const CoreFlow = z.object({
  id: z.string(),
  kind: z.string(),
  mitigated: z.boolean(),
  legs: z.array(z.string()).default([]),
})
export type CoreFlow = z.infer<typeof CoreFlow>

export const CoreFinding = z.object({
  id: z.string(),
  ruleId: z.string(),
  severity: z.string(),
  owasp: z.string().optional(),
  attackId: z.string().optional(),
  flowId: z.string().optional(),
  observed: z.string().optional(),
})
export type CoreFinding = z.infer<typeof CoreFinding>

export const CoreReport = z.object({
  schemaVersion: z.string(),
  target: z.string(),
  criticalCount: z.number(),
  coverage: z.looseObject({}).optional(),
  findings: z.array(CoreFinding).default([]),
  attacks: z.array(CoreAttack).default([]),
  flows: z.array(CoreFlow).default([]),
})
export type CoreReport = z.infer<typeof CoreReport>

export type IngestError =
  | { kind: "parse"; message: string }
  | { kind: "validation"; message: string; issues: readonly { path: string; message: string }[] }

/** Validate an in-memory Core report value. */
export function ingestCoreReport(raw: unknown): Result<CoreReport, IngestError> {
  const parsed = CoreReport.safeParse(raw)
  if (!parsed.success) {
    return err({
      kind: "validation",
      message: `core report failed validation (${parsed.error.issues.length} issue(s))`,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    })
  }
  return ok(parsed.data)
}

/** Parse a Core report from JSON text. */
export function ingestCoreJson(text: string): Result<CoreReport, IngestError> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (cause) {
    return err({ kind: "parse", message: cause instanceof Error ? cause.message : String(cause) })
  }
  return ingestCoreReport(data)
}
