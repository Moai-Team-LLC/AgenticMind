/**
 * MCP input limits (GHSA-46jr-4wx8-v453). Two independent bounds, both applied
 * before any schema validation or model call:
 *
 * - Request body size. mcp-handler buffers the whole body itself (`req.json()`,
 *   no limit) before the SDK transport sees it, so the SDK's own
 *   `maxRequestBodySize` cannot help; `withRequestBodyLimit` reads the body with
 *   a byte counter in front of it and answers 413 once the cap is crossed.
 * - Tool input elements. `maxToolInputElements` (MCP SDK ≥ 1.32) counts array
 *   elements and object keys in one call's arguments; over the cap the call gets
 *   an `isError` result and the schema is never run.
 *
 * `standard` keeps today's behaviour: no limit unless the env var is set.
 * `strict` applies the defaults below; the env vars override in both profiles.
 */

import type { Profile } from "@agenticmind/shared/lib/profile"
import type { Result } from "neverthrow"

import { readCappedBytes } from "@agenticmind/shared/lib/audit/read-capped-json"
import { activeProfile, isStrict } from "@agenticmind/shared/lib/profile"
import { mcpSettings } from "@agenticmind/shared/settings/mcp-settings"
import { err, ok } from "neverthrow"

/**
 * Strict default body cap. The largest tool input is `kl_ingest.text` (≤ 200 000
 * characters). Two-byte UTF-8 text (e.g. Cyrillic) is ~400 KB, but clients that
 * escape non-ASCII as `\uXXXX` (Python's `json.dumps` default) send 6 bytes per
 * character — ~1.2 MB — so the cap leaves room for that.
 */
export const STRICT_MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024

/** Strict default element cap — far above any legitimate call (the largest
 * bounded collections are 20 facts and 8 queries). */
export const STRICT_MAX_TOOL_INPUT_ELEMENTS = 10_000

export type McpLimits = {
  maxRequestBodyBytes?: number
  maxToolInputElements?: number
}

export type McpLimitsRaw = {
  maxRequestBodyBytes?: string
  maxToolInputElements?: string
}

/** Unset / blank ⇒ null (no explicit value). */
const parseLimit = (name: string, raw: string | undefined): Result<number | null, string> => {
  if (raw === undefined || raw.trim() === "") {
    return ok(null)
  }
  const value = Number(raw.trim())
  if (!Number.isSafeInteger(value) || value < 1) {
    return err(`${name}=${JSON.stringify(raw)} must be a positive integer`)
  }
  return ok(value)
}

/** Resolves the limits for a profile from raw env values. Pure. */
export const resolveMcpLimits = (profile: Profile, raw: McpLimitsRaw): Result<McpLimits, string> =>
  parseLimit("MCP_MAX_REQUEST_BODY_BYTES", raw.maxRequestBodyBytes).andThen((body) =>
    parseLimit("MCP_MAX_TOOL_INPUT_ELEMENTS", raw.maxToolInputElements).map(
      (elements): McpLimits => {
        const strict = isStrict(profile)
        const maxRequestBodyBytes = body ?? (strict ? STRICT_MAX_REQUEST_BODY_BYTES : undefined)
        const maxToolInputElements =
          elements ?? (strict ? STRICT_MAX_TOOL_INPUT_ELEMENTS : undefined)
        return {
          ...(maxRequestBodyBytes !== undefined ? { maxRequestBodyBytes } : {}),
          ...(maxToolInputElements !== undefined ? { maxToolInputElements } : {}),
        }
      },
    ),
  )

/** The deployment's limits (validated at boot by index.ts). */
export const resolveActiveMcpLimits = (profile: Profile): Result<McpLimits, string> =>
  resolveMcpLimits(profile, {
    maxRequestBodyBytes: mcpSettings.MCP_MAX_REQUEST_BODY_BYTES,
    maxToolInputElements: mcpSettings.MCP_MAX_TOOL_INPUT_ELEMENTS,
  })

/** For library code after boot: throws on an invalid value boot already refused. */
export const activeMcpLimits = (): McpLimits => {
  const limits = resolveActiveMcpLimits(activeProfile())
  if (limits.isErr()) {
    throw new Error(limits.error)
  }
  return limits.value
}

/** McpServer options carrying the element cap (spread into createMcpHandler's server options). */
export const mcpServerLimitOptions = (limits: McpLimits): { maxToolInputElements?: number } =>
  limits.maxToolInputElements !== undefined
    ? { maxToolInputElements: limits.maxToolInputElements }
    : {}

const tooLarge = (maxBytes: number): Response =>
  Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32_600, message: `Request body exceeds ${maxBytes} bytes` },
      id: null,
    },
    { status: 413 },
  )

/**
 * Wraps a fetch handler so request bodies are read with a byte counter: over
 * `maxBytes` ⇒ 413 and the inner handler never runs. `undefined` ⇒ passthrough.
 */
export const withRequestBodyLimit =
  (
    handler: (req: Request) => Response | Promise<Response>,
    maxBytes?: number,
  ): ((req: Request) => Promise<Response>) =>
  async (req) => {
    if (maxBytes === undefined || req.body === null) {
      return handler(req)
    }
    const read = await readCappedBytes(req, maxBytes)
    if (!read.ok) {
      return tooLarge(maxBytes)
    }
    return handler(
      new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: read.bytes,
        signal: req.signal,
      }),
    )
  }
