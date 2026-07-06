/**
 * `tool_audit_events` collector (FR-9.1 native).
 *
 * Maps AgenticMind's `tool_audit_events` table — the audit trail of external agent-runtime tool
 * activity ingested from Claude Code hook HTTP POSTs (PostToolUse / PermissionRequest /
 * ConfigChange) — to the Accountability controls it satisfies. It is a sibling of `collectNative`
 * (same collector shape: pure `(rows, collectedAt) => EvidenceRecord[]`, `collector: "native"`),
 * written against the real `tool_audit_events` column shape and fed rows as input, so the mapping
 * runs and is tested offline and only the thin Drizzle query is left to wire in the monorepo.
 *
 * Hash-not-text (NFR-3): rows carry `payloadHash` (sha256), never raw tool arguments/output.
 * That is exactly what an audit trail needs — evidence is about EXISTENCE + ATTRIBUTION of logged
 * tool activity, not about replaying payloads.
 */
import type { Collector } from "../catalog/schema"
import type { EvidenceRecord } from "./schema"

/**
 * `tool_audit_events` row — one external agent-runtime audit event (Claude Code hook POST).
 * Mirrors the engine columns: payload is a sha256 hash, `metadata` holds only safe structural
 * fields, and there is never raw text.
 */
export interface ToolAuditEventRow {
  id: string
  /** Ingest source, e.g. "claude-code-hook". */
  source: string
  /** e.g. "PostToolUse" | "PermissionRequest" | "ConfigChange". */
  eventKind: string
  actorUuid: string | null
  sessionId: string | null
  tool: string | null
  /** e.g. "accept" | "reject" | "deny" (nullable). */
  decision: string | null
  /** sha256 of the raw payload — never the raw text (NFR-3). */
  payloadHash: string
  /** Safe structural fields only (no raw payloads). */
  metadata: Record<string, unknown> | null
  createdAt: string
}

const rec = (
  controlId: string,
  sourceArtifact: string,
  collector: Collector,
  collectedAt: string,
  summary: string,
): EvidenceRecord => ({
  id: `ev:${collector}:${controlId}:${sourceArtifact}`,
  controlId,
  sourceArtifact,
  collector,
  collectedAt,
  summary,
})

/**
 * Native collection: turn `tool_audit_events` rows into evidence for the Accountability controls
 * they satisfy. A logged tool call carrying actor/session/tool provenance is per-action decision
 * traceability (AAL-ACC-01); a tamper-evident, hash-not-text log of tool activity with recorded
 * accept/reject/deny decisions is a security-incident audit trail (AAL-ACC-03). Both controls are
 * evidence-only (no Plane-A test required), so this is honest native evidence, never over-claimed.
 * `collectedAt` is passed in so the result is deterministic and reproducible.
 */
export function collectToolAuditEvents(
  rows: ToolAuditEventRow[],
  collectedAt: string,
): EvidenceRecord[] {
  const out: EvidenceRecord[] = []
  if (rows.length === 0) return out

  // Any logged tool event with actor/session provenance → decision traceability (AAL-ACC-01).
  const attributed = rows.filter((r) => r.actorUuid !== null || r.sessionId !== null)
  if (attributed.length > 0) {
    out.push(
      rec(
        "AAL-ACC-01",
        `tool_audit_events:attributed:${attributed.length}`,
        "native",
        collectedAt,
        `${attributed.length} tool-activity event(s) traceable to an actor/session (hashed payloads).`,
      ),
    )
  }

  // Any logged tool event → hash-not-text audit trail (AAL-ACC-03); recorded decisions strengthen it.
  const decided = rows.filter((r) => r.decision !== null)
  out.push(
    rec(
      "AAL-ACC-03",
      `tool_audit_events:${rows.length}`,
      "native",
      collectedAt,
      `${rows.length} tool-audit event(s) logged with sha256 payload hashes` +
        (decided.length > 0
          ? ` and ${decided.length} recorded accept/reject/deny decision(s).`
          : "."),
    ),
  )

  return out
}
