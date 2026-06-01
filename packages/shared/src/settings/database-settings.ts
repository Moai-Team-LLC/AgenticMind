// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

export const databaseSettings = createEnv({
  server: {
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(32),
    // Off by default so a plain local Postgres (no TLS) connects. Set true for
    // Managed Postgres (Supabase, RDS, …) that requires SSL.
    DATABASE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    DATABASE_SSL: process.env.DATABASE_SSL,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})
