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
 * WS2 deferral — honest coverage, do not fabricate. The fourth native source, `tool_audit_events`
 * (the unified tool-call audit trail from WS2), does NOT exist in the lean-OSS engine (v0.13.0): WS2
 * has not landed. Its PURE mapper `collectToolAuditEvents` is shipped and unit-tested in this package
 * (`./tool-audit-events`), ready to wire the day the table exists. Until then this collector harvests
 * only the three artifacts that DO exist (`guard_events`, `ask_telemetry`, `mcp_tokens`); controls
 * that depend on the audit trail score `not_verified` (YELLOW) — the designed graceful-degradation,
 * not a bug. To re-enable once WS2 lands: add `toolAuditEvents` to the schema import, restore its
 * `.select().from()` query in the `Promise.all`, and merge `collectToolAuditEvents(auditRows, …)`
 * into the returned records.
 */
import type { Transaction } from "@agenticmind/shared/database/client"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { askTelemetry, guardEvents, mcpTokens } from "@agenticmind/shared/database/schema"
import { ResultAsync } from "neverthrow"

import {
  collectNative,
  type AskTelemetryRow,
  type EngineRows,
  type GuardEventRow,
  type McpTokenRow,
} from "./collect"

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
 * Harvest native evidence from the live engine: `guard_events`, `ask_telemetry`, `mcp_tokens`.
 * (`tool_audit_events` is deferred to WS2 — see the file header.) Returns immutable, sourced records.
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
    ]),
    mapDatabaseError,
  ).map(([guard, telem, tokens]) => {
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

    return collectNative(rows, collectedAt)
  })
}
