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
 *   bearer. When set, a request whose bearer equals it is granted full scopes
 *   with no JWT and no DB token row — no minting dance. Use a long random value
 *   (>=24 chars); for least-privilege or multi-client setups, use minted JWTs.
 *
 * Both are optional; with neither set the MCP endpoint is unreachable
 * (fail-closed).
 */
export const mcpSettings = createEnv({
  server: {
    AUTH_SECRET: z.string().optional(),
    MCP_API_KEY: z.string().min(24).optional(),
  },
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    MCP_API_KEY: process.env.MCP_API_KEY,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})
