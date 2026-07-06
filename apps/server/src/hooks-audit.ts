/**
 * `POST /hooks/audit` — ingestion for external agent-runtime audit events (the
 * JSON a Claude Code `http`-type hook POSTs on PostToolUse / PermissionRequest /
 * ConfigChange / …). The first non-MCP endpoint on this server (see ADR-0001).
 *
 * Contract: accept-and-return fast. A single indexed INSERT, then a 202 — the
 * endpoint never does heavy synchronous work, so a slow consumer here cannot
 * stall the calling agent's hook. Bearer-gated by the same verifier as /mcp,
 * but requires the dedicated `audit:write` scope. Hash-not-text: raw tool
 * inputs/outputs are never stored (see lib/audit/hook-event).
 */

import { recordToolAuditEvent } from "@agenticmind/shared/database/query/knowledge/tool-audit-events"
import {
  AUDIT_MAX_BYTES,
  hasAuditWriteScope,
  parseHookEvent,
} from "@agenticmind/shared/lib/audit/hook-event"
import { readCappedJson } from "@agenticmind/shared/lib/audit/read-capped-json"

import { verifyMcpAccess } from "@/mcp"
import { getDb } from "@/server/lib/database"

const AUDIT_SOURCE = "claude-code-hook"

const readBearer = (req: Request): string | undefined => {
  const header = req.headers.get("authorization") ?? ""
  if (!header.toLowerCase().startsWith("bearer ")) {
    return undefined
  }
  const value = header.slice("bearer ".length).trim()
  return value.length > 0 ? value : undefined
}

export const hooksAuditFetch = async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const auth = await verifyMcpAccess(req, readBearer(req))
  if (auth === undefined) {
    return new Response("Unauthorized", { status: 401 })
  }
  if (!hasAuditWriteScope(auth.scopes)) {
    return new Response("Forbidden: audit:write scope required", { status: 403 })
  }

  // Bound the body BEFORE buffering it — a huge POST here would otherwise OOM the shared process.
  const body = await readCappedJson(req, AUDIT_MAX_BYTES)
  if (!body.ok) {
    return body.reason === "too_large"
      ? new Response("Payload Too Large", { status: 413 })
      : new Response("Bad Request: invalid JSON", { status: 400 })
  }

  const parsed = parseHookEvent(body.value)
  if (parsed === null) {
    return new Response("Bad Request: unrecognized hook event", { status: 400 })
  }

  const result = await recordToolAuditEvent({
    tx: getDb(),
    event: { source: AUDIT_SOURCE, actorUuid: auth.clientId ?? null, ...parsed },
  })
  if (result.isErr()) {
    console.error("[HOOKS-AUDIT] insert failed:", result.error)
    return new Response("Audit store unavailable", { status: 503 })
  }

  return Response.json({ ok: true, id: result.value[0]?.id }, { status: 202 })
}
