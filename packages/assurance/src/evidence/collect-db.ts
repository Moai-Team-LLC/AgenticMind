/**
 * Native evidence collection from the live engine (FR-9.1) — the thin Drizzle seam.
 *
 * Reads the existing AgenticMind artifacts an auditor needs and feeds them to the PURE mapper
 * (`collectNative`) that is unit-tested in this package. Follows the engine repo convention:
 * `{ tx }` props, `ResultAsync`, `mapDatabaseError`, tables imported from
 * `@agenticmind/shared/database/schema`. Compiles only inside the monorepo (it imports the engine).
 *
 * No new instrumentation on agents (FR-9 non-goal): every read is against a table the engine
 * already writes. Hash-not-text holds — we read hashed columns (`input_hash`), never raw text.
 *
 * Four native sources: `guard_events`, `ask_telemetry`, `mcp_tokens`, and — since WS2 landed —
 * `tool_audit_events` (the unified external-runtime tool-call audit trail, `POST /hooks/audit`).
 * Each is fed to a PURE, unit-tested mapper (`collectNative` / `collectToolAuditEvents`); an artifact
 * the engine does not produce simply yields no evidence, and its controls score `not_verified`
 * (YELLOW) — honest graceful-degradation, never a fabricated GREEN.
 */
import type { Transaction } from "@agenticmind/shared/database/client"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import {
  askTelemetry,
  guardEvents,
  mcpTokens,
  toolAuditEvents,
} from "@agenticmind/shared/database/schema"
import { ResultAsync } from "neverthrow"

import {
  collectNative,
  type AskTelemetryRow,
  type EngineRows,
  type GuardEventRow,
  type McpTokenRow,
} from "./collect"
import { collectToolAuditEvents, type ToolAuditEventRow } from "./tool-audit-events"

/** Bound the sample so evidence collection is a fast, predictable read. */
const SAMPLE_LIMIT = 5000

const iso = (d: Date | string | null): string => (d instanceof Date ? d.toISOString() : (d ?? ""))

export interface CollectFromEngineProps {
  tx: Transaction
  collectedAt: string
  /** The APS/Core `.mcp-tools.lock` content hash, if pinned (supply-chain evidence, AAL-SEC-04). */
  mcpToolsLockHash?: string
}

/**
 * Harvest native evidence from the live engine: `guard_events`, `ask_telemetry`, `mcp_tokens`, and
 * `tool_audit_events` (WS2). Returns immutable, sourced evidence records.
 */
export function collectFromEngine(props: CollectFromEngineProps) {
  const { tx, collectedAt } = props

  return ResultAsync.fromPromise(
    Promise.all([
      tx
        .select({
          id: guardEvents.id,
          tool: guardEvents.tool,
          reason: guardEvents.reason,
          inputHash: guardEvents.inputHash,
          createdAt: guardEvents.createdAt,
        })
        .from(guardEvents)
        .limit(SAMPLE_LIMIT),
      tx
        .select({
          id: askTelemetry.id,
          questionHash: askTelemetry.questionHash,
          model: askTelemetry.model,
          citationCount: askTelemetry.citationCount,
          createdAt: askTelemetry.createdAt,
        })
        .from(askTelemetry)
        .limit(SAMPLE_LIMIT),
      tx
        .select({
          jti: mcpTokens.jti,
          actorType: mcpTokens.actorType,
          scopes: mcpTokens.scopes,
          expiresAt: mcpTokens.expiresAt,
          revokedAt: mcpTokens.revokedAt,
        })
        .from(mcpTokens)
        .limit(SAMPLE_LIMIT),
      tx
        .select({
          id: toolAuditEvents.id,
          source: toolAuditEvents.source,
          eventKind: toolAuditEvents.eventKind,
          actorUuid: toolAuditEvents.actorUuid,
          sessionId: toolAuditEvents.sessionId,
          tool: toolAuditEvents.tool,
          decision: toolAuditEvents.decision,
          payloadHash: toolAuditEvents.payloadHash,
          metadata: toolAuditEvents.metadata,
          createdAt: toolAuditEvents.createdAt,
        })
        .from(toolAuditEvents)
        .limit(SAMPLE_LIMIT),
    ]),
    mapDatabaseError,
  ).map(([guard, telem, tokens, audit]) => {
    const rows: EngineRows = {
      guardEvents: guard.map(
        (g): GuardEventRow => ({
          id: g.id,
          tool: g.tool,
          reason: g.reason as GuardEventRow["reason"],
          inputHash: g.inputHash,
          createdAt: iso(g.createdAt),
        }),
      ),
      askTelemetry: telem.map(
        (a): AskTelemetryRow => ({
          id: a.id,
          questionHash: a.questionHash,
          model: a.model,
          citationCount: a.citationCount,
          createdAt: iso(a.createdAt),
        }),
      ),
      mcpTokens: tokens.map(
        (m): McpTokenRow => ({
          jti: m.jti,
          actorType: m.actorType,
          // engine `mcp_tokens.scopes` is `text[]` (not-null) — already the shape McpTokenRow wants.
          scopes: m.scopes,
          expiresAt: iso(m.expiresAt),
          revokedAt: m.revokedAt === null ? null : iso(m.revokedAt),
        }),
      ),
      ...(props.mcpToolsLockHash ? { mcpToolsLockHash: props.mcpToolsLockHash } : {}),
    }

    const auditRows: ToolAuditEventRow[] = audit.map((t) => ({
      id: t.id,
      source: t.source,
      eventKind: t.eventKind,
      actorUuid: t.actorUuid,
      sessionId: t.sessionId,
      tool: t.tool,
      decision: t.decision,
      payloadHash: t.payloadHash,
      metadata: (t.metadata as Record<string, unknown> | null) ?? null,
      createdAt: iso(t.createdAt),
    }))

    return [...collectNative(rows, collectedAt), ...collectToolAuditEvents(auditRows, collectedAt)]
  })
}
