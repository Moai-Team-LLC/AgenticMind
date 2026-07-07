/**
 * Gap-analysis scoring engine (FR-8).
 *
 * Scores every catalog control Green / Yellow / Red from three inputs: the control's test
 * requirement, AAL Core's findings (per-attack outcomes + toxic flows), and collected evidence.
 * Two hard rules (FR-8.2, NFR-1):
 *   1. A failing Plane-A test forces RED — regardless of any declared mitigation.
 *   2. GREEN requires evidence AND (where a test is required) a passing test. No evidence ⇒ YELLOW.
 */
import type { Catalog, ControlEntry, ControlScope } from "@agenticmind/assurance/catalog/schema"
import type { ControlStatus, EvidenceRecord, Status } from "@agenticmind/assurance/evidence/schema"

import type { CoreReport } from "./ingest"

/** Evidence strength order: native (auto-read from the engine) > generic (OTel) > manual (doc). */
const COLLECTOR_RANK: Record<"native" | "generic" | "manual", number> = {
  native: 3,
  generic: 2,
  manual: 1,
}

/** Which controls a toxic-flow kind is a structural test for (static Plane-A evidence). */
const FLOW_CONTROLS: Record<string, string[]> = {
  "lethal-trifecta": ["AAL-SEC-07"],
  "untrusted-to-code-exec": ["AAL-SEC-07", "AAL-SEC-05"],
}

type TestResult = "not-required" | "passed" | "failed" | "not-verified"

const testResultFor = (
  control: ControlEntry,
  report: CoreReport,
): { result: TestResult; drivingFindings: string[] } => {
  const classes = control.test_requirement.attack_class as readonly string[]
  const requiresTest = control.test_requirement.plane_a && classes.length > 0

  const flowFails = report.flows.filter(
    (f) => !f.mitigated && (FLOW_CONTROLS[f.kind]?.includes(control.id) ?? false),
  )
  const mappedAttacks = report.attacks.filter((a) => classes.includes(a.attackClass))

  const failing = [
    ...flowFails.map((f) => f.id),
    ...mappedAttacks
      .filter((a) => a.outcome === "succeeded" || a.refuseButFire)
      .map((a) => a.attackId),
  ]
  if (failing.length > 0) {
    return { result: "failed", drivingFindings: failing }
  }
  if (!requiresTest) {
    return { result: "not-required", drivingFindings: [] }
  }

  // Required test, nothing failed. Fail-closed: passed only if an attack actually ran and was
  // contained; a not_verified attack or no coverage is not_verified, never a silent pass.
  if (mappedAttacks.length === 0 || mappedAttacks.some((a) => a.outcome === "not_verified")) {
    return { result: "not-verified", drivingFindings: [] }
  }
  return { result: "passed", drivingFindings: [] }
}

/** Score one control G/Y/R. */
export const scoreControl = (
  control: ControlEntry,
  report: CoreReport,
  evidence: EvidenceRecord[],
): ControlStatus => {
  const ev = evidence.filter((e) => e.controlId === control.id)
  const { result, drivingFindings } = testResultFor(control, report)
  // Evidence must be at least as strong as the control requires: a native-required control is not
  // GREEN on merely generic/manual evidence — that degradation is surfaced honestly, not passed
  // (FR-9.2). Coverage still counts the actual mix.
  const hasSufficientEvidence = ev.some(
    (e) => COLLECTOR_RANK[e.collector] >= COLLECTOR_RANK[control.evidence_requirement.collector],
  )

  let status: Status
  let rationale: string
  if (result === "failed") {
    status = "red"
    rationale = `A mapped Plane-A test failed (${drivingFindings.join(", ")}) — RED regardless of any declared mitigation.`
  } else if (hasSufficientEvidence && (result === "not-required" || result === "passed")) {
    status = "green"
    rationale =
      result === "passed"
        ? "Evidence present and the required Plane-A test passed."
        : "Evidence present; no Plane-A test is required for this control."
  } else {
    status = "yellow"
    rationale =
      ev.length === 0
        ? "No collected evidence — not_verified (never Green on absence of evidence)."
        : hasSufficientEvidence
          ? "Required test not conclusively passed (not_verified)."
          : `Only degraded evidence (weaker than the required ${control.evidence_requirement.collector} collector) — not_verified.`
  }

  return {
    controlId: control.id,
    status,
    drivingEvidence: ev.map((e) => e.id),
    drivingFindings,
    rationale,
  }
}

/** Score the whole catalog (optionally filtered to a scope, e.g. `core` for the v1.0 domains). */
export const scoreCatalog = (
  catalog: Catalog,
  report: CoreReport,
  evidence: EvidenceRecord[],
  opts: { scope?: ControlScope } = {},
): ControlStatus[] => {
  const controls = opts.scope
    ? catalog.controls.filter((c) => c.scope === opts.scope)
    : catalog.controls
  return controls.map((c) => scoreControl(c, report, evidence))
}

/** Count statuses. */
export const statusCounts = (statuses: ControlStatus[]): Record<Status, number> => {
  const counts: Record<Status, number> = { green: 0, yellow: 0, red: 0 }
  for (const s of statuses) {
    counts[s.status]++
  }
  return counts
}
