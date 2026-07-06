/**
 * Drift detection (FR-10.2).
 *
 * Diffs the latest auditor bundle against the prior run and flags status changes per control — a
 * previously-Green control going Red is the regression that matters most. Continuous assurance is
 * a bundle regenerated on a schedule (the scheduled worker is the in-monorepo `apps/worker` piece);
 * this is the pure, deterministic diff it runs each cycle.
 */
import type { Status } from "../evidence/schema"
import type { AuditorBundle } from "./build"

export interface StatusChange {
  controlId: string
  from: Status
  to: Status
}

export interface DriftReport {
  /** Controls whose status got worse (e.g. green→yellow, green→red, yellow→red). */
  regressions: StatusChange[]
  /** Controls whose status got better. */
  improvements: StatusChange[]
  /** Control ids present in the new bundle but not the prior one. */
  added: string[]
  /** Control ids present in the prior bundle but not the new one. */
  removed: string[]
  /** True if any control regressed all the way from green to red — the alerting condition. */
  hasCriticalDrift: boolean
}

/** Worse status = higher number. */
const STATUS_ORDER: Record<Status, number> = { green: 0, yellow: 1, red: 2 }

/** Diff a new bundle against the prior one. Order-independent, deterministic. */
export function diffBundles(prev: AuditorBundle, next: AuditorBundle): DriftReport {
  const prevStatus = new Map(prev.controls.map((c) => [c.controlId, c.status]))
  const nextStatus = new Map(next.controls.map((c) => [c.controlId, c.status]))

  const regressions: StatusChange[] = []
  const improvements: StatusChange[] = []
  let hasCriticalDrift = false

  for (const [controlId, to] of nextStatus) {
    const from = prevStatus.get(controlId)
    if (from === undefined || from === to) continue
    const change: StatusChange = { controlId, from, to }
    if (STATUS_ORDER[to] > STATUS_ORDER[from]) {
      regressions.push(change)
      if (from === "green" && to === "red") hasCriticalDrift = true
    } else {
      improvements.push(change)
    }
  }

  const added = [...nextStatus.keys()].filter((id) => !prevStatus.has(id))
  const removed = [...prevStatus.keys()].filter((id) => !nextStatus.has(id))

  return { regressions, improvements, added, removed, hasCriticalDrift }
}
