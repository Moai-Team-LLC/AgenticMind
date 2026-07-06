/**
 * Evidence collectors (FR-9.1 native, FR-9.2 generic) + honest coverage (NFR-8).
 *
 * The native collectors map an AgenticMind engine artifact to the control(s) it satisfies. They
 * are written against the ENGINE'S REAL row shapes (verified against
 * packages/shared/src/database/schema/knowledge/*) and take the rows as input — so the pure
 * mapping runs and is tested offline, and only the thin Drizzle query that supplies the rows is
 * left to wire when this package lands inside the monorepo.
 *
 * NOTE (blueprint vs. engine reconciliation): the current engine has `guard_events`,
 * `ask-telemetry`, and `mcp-tokens`; it does NOT (yet) expose named `faithfulness`/`entailment`
 * tables or a tenant-isolation eval / tenant column. Controls that depend on those are left
 * `not_verified` (no native evidence) rather than fabricated.
 */
import type { Collector } from "../catalog/schema"
import type { EvidenceRecord } from "./schema"

// --- Real engine row shapes (from packages/shared/.../schema/knowledge/*) -------------------

/** `guard_events` row — one blocked/redacted request (hashed input, never raw text). */
export interface GuardEventRow {
  id: string
  tool: string
  reason: "injection" | "pii_redacted" | "rate_limited" | "output_leak" | "too_long"
  inputHash: string | null
  createdAt: string
}

/** `ask-telemetry` row — the replayable why-trace of one answer. */
export interface AskTelemetryRow {
  id: string
  questionHash: string
  model: string
  citationCount: number
  createdAt: string
}

/** `mcp-tokens` row — a scoped, expiring agent credential (JWT). */
export interface McpTokenRow {
  jti: string
  actorType: string
  scopes: string[] | null
  expiresAt: string
  revokedAt: string | null
}

export interface EngineRows {
  guardEvents?: GuardEventRow[]
  askTelemetry?: AskTelemetryRow[]
  mcpTokens?: McpTokenRow[]
  /** The APS/Core `.mcp-tools.lock` content hash, if pinned. */
  mcpToolsLockHash?: string
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
 * Native collection: turn existing engine rows into evidence records for the controls they
 * satisfy (per the catalog's evidence_requirement). `collectedAt` is passed in so the result is
 * deterministic and reproducible.
 */
export function collectNative(rows: EngineRows, collectedAt: string): EvidenceRecord[] {
  const out: EvidenceRecord[] = []
  const guard = rows.guardEvents ?? []

  // guard_events(injection) → prompt-injection resistance (AAL-SEC-01)
  const injections = guard.filter((g) => g.reason === "injection")
  if (injections.length > 0) {
    out.push(
      rec(
        "AAL-SEC-01",
        `guard_events:injection:${injections.length}`,
        "native",
        collectedAt,
        `${injections.length} injection event(s) filtered and logged (hashed input).`,
      ),
    )
  }
  // guard_events(pii_redacted) → PII leakage prevention (AAL-DAP-01)
  const pii = guard.filter((g) => g.reason === "pii_redacted")
  if (pii.length > 0) {
    out.push(
      rec(
        "AAL-DAP-01",
        `guard_events:pii_redacted:${pii.length}`,
        "native",
        collectedAt,
        `${pii.length} PII redaction event(s) recorded.`,
      ),
    )
  }
  // guard_events(any) → security incident logging / audit trail (AAL-ACC-03)
  if (guard.length > 0) {
    out.push(
      rec(
        "AAL-ACC-03",
        `guard_events:${guard.length}`,
        "native",
        collectedAt,
        `${guard.length} guarded incident(s) logged with hashed inputs and reasons.`,
      ),
    )
  }
  // ask-telemetry → decision traceability / replayable why-trace (AAL-ACC-01)
  const telem = rows.askTelemetry ?? []
  if (telem.length > 0) {
    out.push(
      rec(
        "AAL-ACC-01",
        `ask_telemetry:${telem.length}`,
        "native",
        collectedAt,
        `${telem.length} replayable why-trace record(s) present.`,
      ),
    )
  }
  // mcp-tokens → scoped, short-lived agent identity (AAL-SEC-03)
  const tokens = rows.mcpTokens ?? []
  const scoped = tokens.filter((t) => (t.scopes?.length ?? 0) > 0)
  if (scoped.length > 0) {
    out.push(
      rec(
        "AAL-SEC-03",
        `mcp_tokens:scoped:${scoped.length}`,
        "native",
        collectedAt,
        `${scoped.length} scoped, expiring agent credential(s).`,
      ),
    )
  }
  // .mcp-tools.lock → supply-chain / tool pinning (AAL-SEC-04)
  if (rows.mcpToolsLockHash) {
    out.push(
      rec(
        "AAL-SEC-04",
        `mcp_tools_lock:${rows.mcpToolsLockHash.slice(0, 16)}`,
        "native",
        collectedAt,
        "MCP tool definitions pinned by hash (rug-pull tripwire in place).",
      ),
    )
  }
  return out
}

/** A manual/attested evidence record for a control that cannot be auto-collected (FR-9.2). */
export function collectManual(
  controlId: string,
  artifactRef: string,
  collectedAt: string,
  summary: string,
): EvidenceRecord {
  return rec(controlId, artifactRef, "manual", collectedAt, summary)
}

export interface Coverage {
  native: number
  generic: number
  manual: number
  none: number
  total: number
  /** Fraction of controls backed by auto-collected (native) evidence. */
  ratio: number
}

/** Honest coverage across all catalog control ids: native vs generic/manual/none (NFR-8). */
export function computeCoverage(controlIds: string[], evidence: EvidenceRecord[]): Coverage {
  const best = new Map<string, Collector>()
  const rank: Record<Collector, number> = { native: 3, generic: 2, manual: 1 }
  for (const e of evidence) {
    const cur = best.get(e.controlId)
    if (!cur || rank[e.collector] > rank[cur]) best.set(e.controlId, e.collector)
  }
  let native = 0
  let generic = 0
  let manual = 0
  let none = 0
  for (const id of controlIds) {
    const c = best.get(id)
    if (c === "native") native++
    else if (c === "generic") generic++
    else if (c === "manual") manual++
    else none++
  }
  const total = controlIds.length
  return { native, generic, manual, none, total, ratio: total === 0 ? 0 : native / total }
}
