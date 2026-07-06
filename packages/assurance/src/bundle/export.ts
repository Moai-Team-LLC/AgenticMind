/**
 * Auditor bundle export (FR-10.3).
 *
 * Renders the bundle as structured JSON (for downstream compliance tooling) and Markdown (for
 * humans/auditors). Both carry the mandatory coverage ratio (NFR-8) and are payload-free.
 */
import type { Status } from "../evidence/schema"
import type { AuditorBundle } from "./build"

/** Schema-versioned JSON for downstream ingestion. */
export function bundleToJson(bundle: AuditorBundle): string {
  return JSON.stringify(bundle, null, 2)
}

const ICON: Record<Status, string> = { green: "🟢", yellow: "🟡", red: "🔴" }

export function coverageLine(bundle: AuditorBundle): string {
  const c = bundle.coverage
  const pct = Math.round(c.ratio * 100)
  return `${c.native}/${c.total} controls backed by auto-collected (native) evidence (${pct}%); generic ${c.generic}, manual ${c.manual}, none ${c.none}`
}

export function bundleToMarkdown(bundle: AuditorBundle): string {
  const c = bundle.statusCounts
  const lines: string[] = [
    `# AAL Evidence — Auditor Bundle`,
    "",
    `**Target:** ${bundle.target}`,
    `**Catalog version:** ${bundle.catalogVersion}`,
    `**Status:** ${ICON.red} ${c.red} red · ${ICON.yellow} ${c.yellow} yellow · ${ICON.green} ${c.green} green`,
    `**Coverage:** ${coverageLine(bundle)}`,
    "",
    "## Controls",
    "",
    "| Control | Domain | Status | Rationale |",
    "|---|---|---|---|",
  ]
  for (const ctrl of bundle.controls) {
    lines.push(
      `| ${ctrl.controlId} — ${ctrl.title} | ${ctrl.domain} | ${ICON[ctrl.status]} ${ctrl.status} | ${ctrl.rationale} |`,
    )
  }

  lines.push("", "## Remediation (prioritized)", "")
  if (bundle.remediation.length === 0) {
    lines.push("_No gaps — every control is green._", "")
  } else {
    for (const item of bundle.remediation) {
      lines.push(
        `### ${ICON[item.status]} ${item.controlId} — ${item.title}`,
        "",
        `- **Action:** ${item.action}`,
        `- **Links:** ${item.links.map((l) => `\`${l}\``).join(", ")}`,
        "",
      )
    }
  }

  lines.push(
    "## Evidence",
    "",
    ...(bundle.evidence.length === 0
      ? ["_No evidence collected._"]
      : bundle.evidence.map(
          (e) =>
            `- \`${e.id}\` (${e.collector}) → ${e.controlId}: ${e.summary} [source: \`${e.sourceArtifact}\`]`,
        )),
    "",
    "## Notes",
    "",
    "- A failing Plane-A test forces RED regardless of any declared mitigation (tests beat claims).",
    "- No control is GREEN without collected evidence; inconclusive is reported as not_verified (fail-closed).",
    "- Evidence is referenced by source id/hash — no raw incident text (hash-not-text).",
    "",
  )
  return lines.join("\n")
}
