// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

/**
 * MCP auth configuration.
 *
 * - `AUTH_SECRET` signs/verifies per-token MCP bearer JWTs (typ="mcp"), the
 *   least-privilege, revocable path (mint with `issue-token`).
 * - `MCP_API_KEY` is the simple single-tenant alternative: one shared static
 *   bearer. When set, a request whose bearer equals it is granted the
 *   knowledge/memory read-write-admin scopes and audit:write (not
 *   knowledge:signal or hitl:*) with no JWT and no DB token row. Use a long random value
 *   (>=24 chars); for least-privilege or multi-client setups, use minted JWTs.
 *
 * Both are optional; with neither set the MCP endpoint is unreachable
 * (fail-closed).
 *
 * Input limits (GHSA-46jr-4wx8-v453), parsed by apps/server/src/mcp-limits.ts:
 * - `MCP_MAX_REQUEST_BODY_BYTES` caps the /mcp request body before it is read
 *   into memory or parsed.
 * - `MCP_MAX_TOOL_INPUT_ELEMENTS` caps the array elements + object keys in one
 *   tool call's arguments, checked before schema validation.
 * Unset in `standard` ⇒ no limit (today's behaviour); `strict` applies defaults.
 */
export const mcpSettings = createEnv({
  server: {
    AUTH_SECRET: z.string().optional(),
    MCP_API_KEY: z.string().min(24).optional(),
    MCP_MAX_REQUEST_BODY_BYTES: z.string().optional(),
    MCP_MAX_TOOL_INPUT_ELEMENTS: z.string().optional(),
  },
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    MCP_API_KEY: process.env.MCP_API_KEY,
    MCP_MAX_REQUEST_BODY_BYTES: process.env.MCP_MAX_REQUEST_BODY_BYTES,
    MCP_MAX_TOOL_INPUT_ELEMENTS: process.env.MCP_MAX_TOOL_INPUT_ELEMENTS,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})
