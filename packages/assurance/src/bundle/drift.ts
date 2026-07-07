/**
 * Drift detection (FR-10.2).
 *
 * Diffs the latest auditor bundle against the prior run and flags status changes per control — a
 * previously-Green control going Red is the regression that matters most. Continuous assurance is
 * a bundle regenerated on a schedule (the scheduled worker is the in-monorepo `apps/worker` piece);
 * this is the pure, deterministic diff it runs each cycle.
 */
import type { Status } from "@agenticmind/assurance/evidence/schema"

import type { AuditorBundle } from "./build"

export type StatusChange = {
  controlId: string
  from: Status
  to: Status
}

export type DriftReport = {
  /** Controls whose status got worse (e.g. green→yellow, green→red, yellow→red). */
  regressions: StatusChange[]
  /** Controls whose status got better. */
  improvements: StatusChange[]
  /** Control ids present in the new run but not the prior one. */
  added: string[]
  /** Control ids present in the prior run but not the new one. */
  removed: string[]
  /** True if any control regressed all the way from green to red — the alerting condition. */
  hasCriticalDrift: boolean
}

/** The minimal, persistable shape a drift comparison needs: one control's id + its scored status. */
export type ControlSnapshot = {
  controlId: string
  status: Status
}

export type DriftAlert = {
  severity: "critical" | "warning"
  message: string
  regressions: StatusChange[]
}

/** Worse status = higher number. */
const STATUS_ORDER: Record<Status, number> = { green: 0, yellow: 1, red: 2 }

/** Reduce a bundle to the status snapshot a drift comparison (and a persisted run) needs. */
export const snapshotBundle = (bundle: Pick<AuditorBundle, "controls">): ControlSnapshot[] =>
  bundle.controls.map((c) => {
    return { controlId: c.controlId, status: c.status }
  })

/** Diff two status snapshots. Order-independent, deterministic — the heart of drift detection. */
export const diffSnapshots = (prev: ControlSnapshot[], next: ControlSnapshot[]): DriftReport => {
  const prevStatus = new Map(prev.map((c) => [c.controlId, c.status]))
  const nextStatus = new Map(next.map((c) => [c.controlId, c.status]))

  const regressions: StatusChange[] = []
  const improvements: StatusChange[] = []
  let hasCriticalDrift = false

  for (const [controlId, to] of nextStatus) {
    const from = prevStatus.get(controlId)
    if (from === undefined || from === to) {
      continue
    }
    const change: StatusChange = { controlId, from, to }
    if (STATUS_ORDER[to] > STATUS_ORDER[from]) {
      regressions.push(change)
      if (from === "green" && to === "red") {
        hasCriticalDrift = true
      }
    } else {
      improvements.push(change)
    }
  }

  const added = [...nextStatus.keys()].filter((id) => !prevStatus.has(id))
  const removed = [...prevStatus.keys()].filter((id) => !nextStatus.has(id))

  return { regressions, improvements, added, removed, hasCriticalDrift }
}

/** Diff a new bundle against the prior one. */
export const diffBundles = (prev: AuditorBundle, next: AuditorBundle): DriftReport =>
  diffSnapshots(snapshotBundle(prev), snapshotBundle(next))

/**
 * Continuous-assurance decision (FR-10.2): compare this run's snapshot to the prior. The first run
 * (no prior) is a baseline — no drift, no alert. A green→red regression is critical; any other
 * regression is a warning. Improvements never alert.
 */
export const evaluateDrift = (
  prev: ControlSnapshot[] | null,
  next: ControlSnapshot[],
): { report: DriftReport | null; alert: DriftAlert | null } => {
  if (prev === null) {
    return { report: null, alert: null }
  }
  const report = diffSnapshots(prev, next)
  if (report.regressions.length === 0) {
    return { report, alert: null }
  }
  const alert: DriftAlert = {
    severity: report.hasCriticalDrift ? "critical" : "warning",
    message: report.hasCriticalDrift
      ? `${report.regressions.length} control(s) regressed — a control fell green→red.`
      : `${report.regressions.length} control(s) regressed.`,
    regressions: report.regressions,
  }
  return { report, alert }
}
