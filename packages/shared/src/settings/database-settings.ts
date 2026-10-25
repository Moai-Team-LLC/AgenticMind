// oxlint-disable node/no-process-env
// Settings modules are the only place in this repository where direct process.env access is allowed.

import { createEnv } from "@t3-oss/env-core"
import * as z from "zod"

export const databaseSettings = createEnv({
  server: {
    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(32),
    // Optional least-privilege runtime role for multi-tenant RLS. When set,
    // withTenant() issues `SET LOCAL ROLE <role>` per transaction so the
    // tenant_isolation policy is enforced even if the connection logs in as a
    // superuser/owner (which would otherwise bypass RLS). Provisioned by
    // migration 0004 as `agenticmind_app`. Leave unset for single-tenant.
    DATABASE_APP_ROLE: z.string().optional(),
    // Off by default so a plain local Postgres (no TLS) connects. Set true for
    // Managed Postgres (Supabase, RDS, …) that requires SSL.
    DATABASE_SSL: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // CA bundle (PEM text, or a path to a PEM file) to verify the database
    // server certificate against. Setting it turns verification on in every
    // profile; the strict profile verifies even without it (system CAs).
    DATABASE_SSL_CA: z.string().optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX,
    DATABASE_APP_ROLE: process.env.DATABASE_APP_ROLE,
    DATABASE_SSL: process.env.DATABASE_SSL,
    DATABASE_SSL_CA: process.env.DATABASE_SSL_CA,
  },
  isServer: typeof window === "undefined",
  skipValidation: process.env.SKIP_VALIDATION?.toLowerCase() === "true",
})
