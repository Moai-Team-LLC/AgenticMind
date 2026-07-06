/**
 * Continuous-assurance drift sweep (FR-10). Each cycle: harvest the engine's native evidence, score
 * the control catalog into a status snapshot, diff it against the prior run, persist the run, and
 * alert on a regression.
 *
 * The scheduled sweep runs against an EMPTY Core report, so it monitors NATIVE-EVIDENCE drift — a
 * control that loses its backing evidence degrades (green→yellow) and is flagged. To also catch a
 * control regressing green→red under attack, feed a fresh `aal scan --json` report in place of the
 * empty one (a Plane-A scan is a separate scheduled input, not something the worker runs itself).
 */
import type { Transaction } from "@agenticmind/shared/database/client"

import {
  assembleBundle,
  collectFromEngine,
  evaluateDrift,
  ingestCoreReport,
  loadBundledCatalog,
  snapshotBundle,
  type ControlSnapshot,
  type CoreReport,
} from "@agenticmind/assurance"
import {
  latestAssuranceRun,
  recordAssuranceRun,
} from "@agenticmind/shared/database/query/assurance/runs"
import { SpanKind, withSpan } from "@agenticmind/shared/lib/observability/trace"

/** The engine under continuous assurance — a stable id so a run diffs against its own history. */
const TARGET = "agenticmind-engine"

/** An empty Plane-A report: no attacks/flows/findings, so scoring reflects native evidence only. */
function emptyCoreReport(target: string): CoreReport {
  const report = ingestCoreReport({
    schemaVersion: "aal-core-report/0.1",
    target,
    criticalCount: 0,
    findings: [],
    attacks: [],
    flows: [],
  })
  if (report.isErr()) {
    throw new Error(`empty core report failed to build: ${report.error.message}`)
  }
  return report.value
}

export const runAssuranceDriftSweep = async (db: Transaction): Promise<void> =>
  withSpan("assurance.drift_sweep", SpanKind.CHAIN, async (span) => {
    const at = new Date().toISOString()
    console.log(`[WORKER] ${at}: assurance drift sweep starting (target=${TARGET})`)

    const catalog = loadBundledCatalog()
    if (catalog.isErr()) {
      console.error("[ASSURANCE_DRIFT] catalog load failed:", catalog.error)
      return
    }

    const collected = await collectFromEngine({ tx: db, collectedAt: at })
    if (collected.isErr()) {
      console.error("[ASSURANCE_DRIFT] evidence collection failed:", collected.error)
      return
    }

    const bundle = assembleBundle(catalog.value, emptyCoreReport(TARGET), collected.value)
    const snapshot = snapshotBundle(bundle)

    const prior = await latestAssuranceRun({ tx: db, target: TARGET })
    if (prior.isErr()) {
      console.error("[ASSURANCE_DRIFT] prior-run read failed:", prior.error)
      return
    }

    const previous = prior.value === null ? null : (prior.value.snapshot as ControlSnapshot[])
    const { report, alert } = evaluateDrift(previous, snapshot)

    const recorded = await recordAssuranceRun({
      tx: db,
      run: { target: TARGET, snapshot, criticalDrift: report?.hasCriticalDrift ?? false },
    })
    if (recorded.isErr()) {
      console.error("[ASSURANCE_DRIFT] run persist failed:", recorded.error)
      return
    }

    span.setAttribute("assurance.controls", snapshot.length)
    span.setAttribute("assurance.regressions", report?.regressions.length ?? 0)

    if (alert === null) {
      console.log(
        `[ASSURANCE_DRIFT] no drift (${snapshot.length} controls, baseline=${previous === null})`,
      )
      return
    }
    // The alert channel (HITL Telegram/Slack, per the self-healing-ops design) is a seam; until it
    // is wired, surface at the right log level so critical drift is not silent.
    const log = alert.severity === "critical" ? console.error : console.warn
    log(
      `[ASSURANCE_DRIFT] ${alert.severity.toUpperCase()} drift: ${alert.message}`,
      alert.regressions,
    )
  })
