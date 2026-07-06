/**
 * Auditor bundle assembly (FR-10.1).
 *
 * One call turns a catalog + an AAL Core report + collected evidence into the deliverable an
 * auditor accepts: every control scored G/Y/R with its linked evidence and driving findings, a
 * prioritized remediation plan, and an honest coverage ratio. Deterministic (timestamp-free)
 * so it is reproducible and diffable for drift.
 */
import type { Aiuc1Domain, Catalog, ControlScope, OwaspAsi } from "../catalog/schema"
import type { ControlStatus, EvidenceRecord, Status } from "../evidence/schema"
import type { CoreReport } from "../gap/ingest"

import { computeCoverage, type Coverage } from "../evidence/collect"
import { remediationPlan, type RemediationItem } from "../gap/plan"
import { scoreCatalog, statusCounts } from "../gap/score"

export interface ScoredControl extends ControlStatus {
  title: string
  domain: Aiuc1Domain
  scope: ControlScope
  owasp: OwaspAsi[]
}

export interface AuditorBundle {
  schemaVersion: "aal-evidence-bundle/0.1"
  target: string
  catalogVersion: string
  statusCounts: Record<Status, number>
  controls: ScoredControl[]
  remediation: RemediationItem[]
  coverage: Coverage
  evidence: EvidenceRecord[]
}

export function assembleBundle(
  catalog: Catalog,
  report: CoreReport,
  evidence: EvidenceRecord[],
  opts: { scope?: ControlScope } = {},
): AuditorBundle {
  const statuses = scoreCatalog(catalog, report, evidence, opts)
  const byId = new Map(catalog.controls.map((c) => [c.id, c]))

  const controls: ScoredControl[] = []
  for (const s of statuses) {
    const c = byId.get(s.controlId)
    if (!c) continue
    controls.push({
      ...s,
      title: c.title,
      domain: c.aiuc1_domain,
      scope: c.scope,
      owasp: c.owasp_asi,
    })
  }

  return {
    schemaVersion: "aal-evidence-bundle/0.1",
    target: report.target,
    catalogVersion: catalog.version,
    statusCounts: statusCounts(statuses),
    controls,
    remediation: remediationPlan(catalog, statuses),
    coverage: computeCoverage(
      statuses.map((s) => s.controlId),
      evidence,
    ),
    evidence,
  }
}
