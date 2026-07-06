/**
 * Pure mapping from an external agent-runtime hook payload (the JSON a Claude
 * Code `http`-type hook POSTs) to a `tool_audit_events` row — with no DB and no
 * I/O, so it is unit-testable offline.
 *
 * Hash-not-text: the raw payload is sha256-hashed into `payloadHash`; only safe
 * structural fields are kept as columns / curated metadata. Tool inputs and
 * responses (potentially secrets, PII, poisoned content) are NEVER stored — we
 * record only that an event of a given shape occurred, and its fingerprint.
 */

import { createHash } from "node:crypto"

/** The scope a bearer must carry to POST audit events. */
export const AUDIT_WRITE_SCOPE = "audit:write"

/**
 * Max accepted body size for a single audit event, in bytes. Bounds per-request memory so an
 * authenticated caller cannot OOM the shared server process (which also serves /mcp) by POSTing a
 * huge body — the body is buffered before parsing, so the cap must be enforced during the read.
 * Audit events are small structural payloads; 1 MiB comfortably fits a hook event (even one whose
 * tool payload we only hash) while rejecting the abuse case. Mirrors `MAX_UPLOAD_BYTES`.
 */
export const AUDIT_MAX_BYTES = 1024 * 1024

export const hasAuditWriteScope = (scopes: readonly string[] | undefined): boolean =>
  scopes !== undefined && scopes.includes(AUDIT_WRITE_SCOPE)

/** The content-bearing fields of a parsed event (actor + source added by the caller). */
export type ParsedHookEvent = {
  eventKind: string
  sessionId: string | null
  tool: string | null
  decision: string | null
  payloadHash: string
  metadata: Record<string, unknown>
}

const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Best-effort decision extraction from the varied hook shapes. */
const readDecision = (p: Record<string, unknown>): string | null => {
  const direct = asString(p["decision"]) ?? asString(p["permissionDecision"])
  if (direct !== null) {
    return direct
  }
  const resp = p["tool_response"] ?? p["hook_response"]
  if (isRecord(resp)) {
    return asString(resp["decision"]) ?? asString(resp["permissionDecision"])
  }
  return null
}

/**
 * Parse + normalize a raw hook payload. Returns null when the payload is not an
 * object or carries no identifiable event name (`hook_event_name` / `event`) —
 * the one hard requirement, so we never record a shapeless row.
 */
export const parseHookEvent = (raw: unknown): ParsedHookEvent | null => {
  if (!isRecord(raw)) {
    return null
  }
  const eventKind = asString(raw["hook_event_name"]) ?? asString(raw["event"])
  if (eventKind === null) {
    return null
  }

  const payloadHash = createHash("sha256").update(JSON.stringify(raw)).digest("hex")

  // Only non-sensitive structural fields — never tool_input / tool_response bodies.
  const metadata: Record<string, unknown> = {}
  const cwd = asString(raw["cwd"])
  if (cwd !== null) {
    metadata["cwd"] = cwd
  }
  const permissionMode = asString(raw["permission_mode"]) ?? asString(raw["permissionMode"])
  if (permissionMode !== null) {
    metadata["permission_mode"] = permissionMode
  }
  const promptId = asString(raw["prompt_id"]) ?? asString(raw["promptId"])
  if (promptId !== null) {
    metadata["prompt_id"] = promptId
  }
  const toolUseId = asString(raw["tool_use_id"]) ?? asString(raw["toolUseId"])
  if (toolUseId !== null) {
    metadata["tool_use_id"] = toolUseId
  }
  metadata["has_tool_input"] = raw["tool_input"] !== undefined
  metadata["has_tool_response"] = raw["tool_response"] !== undefined

  return {
    eventKind,
    sessionId: asString(raw["session_id"]) ?? asString(raw["sessionId"]),
    tool: asString(raw["tool_name"]) ?? asString(raw["tool"]),
    decision: readDecision(raw),
    payloadHash,
    metadata,
  }
}
