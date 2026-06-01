// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

/**
 * Secret for signing/verifying MCP bearer JWTs (typ="mcp"). Optional —
 * absence disables the /api/mcp endpoint (it returns 503), so a deployment
 * that doesn't expose MCP to external clients needs nothing set.
 */
export const mcpSettings = createEnv({
  server: {
    AUTH_SECRET: z.string().optional(),
  },
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})
