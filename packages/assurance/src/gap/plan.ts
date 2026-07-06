/**
 * Prioritized remediation plan (FR-8.3).
 *
 * Orders non-Green controls by (status severity × control weight) and links each to the driving
 * finding(s) or the missing evidence artifact, so remediation is unambiguous.
 */
import type { Catalog, ControlScope } from "../catalog/schema"
import type { ControlStatus, Status } from "../evidence/schema"

export interface RemediationItem {
  controlId: string
  title: string
  status: Exclude<Status, "green">
  priority: number
  action: string
  /** Driving AAL Core finding ids, or a "missing evidence: …" pointer. */
  links: string[]
}

const STATUS_WEIGHT: Record<Status, number> = { red: 2, yellow: 1, green: 0 }
const SCOPE_WEIGHT: Record<ControlScope, number> = { core: 2, expand: 1, deferred: 0 }

export function remediationPlan(catalog: Catalog, statuses: ControlStatus[]): RemediationItem[] {
  const byId = new Map(catalog.controls.map((c) => [c.id, c]))
  const items: RemediationItem[] = []

  for (const s of statuses) {
    if (s.status === "green") continue
    const control = byId.get(s.controlId)
    if (!control) continue

    const links =
      s.drivingFindings.length > 0
        ? s.drivingFindings
        : [
            `missing evidence: ${control.evidence_requirement.artifact} (${control.evidence_requirement.collector})`,
          ]
    const action =
      s.status === "red"
        ? `Fix the failing Plane-A test, then re-scan. ${control.status_rule}`
        : `Collect the required ${control.evidence_requirement.collector} evidence: ${control.evidence_requirement.artifact}.`

    items.push({
      controlId: s.controlId,
      title: control.title,
      status: s.status,
      priority: STATUS_WEIGHT[s.status] * 10 + SCOPE_WEIGHT[control.scope],
      action,
      links,
    })
  }

  return items.toSorted((a, b) => b.priority - a.priority)
}
