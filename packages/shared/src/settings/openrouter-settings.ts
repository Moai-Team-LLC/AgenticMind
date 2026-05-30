// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

export const openrouterSettings = createEnv({
  server: {
    OPENROUTER_API_KEY: z.string().min(1),
  },
  runtimeEnv: {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})
