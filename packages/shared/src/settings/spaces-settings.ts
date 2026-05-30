// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

export const spacesSettings = createEnv({
  server: {
    SPACES_ACCESS_KEY: z.string().min(1),
    SPACES_SECRET_KEY: z.string().min(1),
    SPACES_REGION: z.string().min(1),
  },
  runtimeEnv: {
    SPACES_ACCESS_KEY: process.env.SPACES_ACCESS_KEY,
    SPACES_SECRET_KEY: process.env.SPACES_SECRET_KEY,
    SPACES_REGION: process.env.SPACES_REGION,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})
