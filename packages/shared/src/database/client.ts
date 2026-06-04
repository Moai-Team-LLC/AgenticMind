import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import { schema } from "@agenticmind/shared/database/schema"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

type Database = NodePgDatabase<typeof schema>

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0] | Database

const createClient = (databaseUrl: string): NodePgDatabase<typeof schema> => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: databaseSettings.DATABASE_POOL_MAX,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 5000,
    // String() guards the SKIP_VALIDATION path, where the Zod transform is
    // Bypassed and DATABASE_SSL arrives as a raw string ("false" is truthy).
    ssl: String(databaseSettings.DATABASE_SSL) === "true" ? { rejectUnauthorized: false } : false,
  })

  return drizzle({
    client: pool,
    schema,
  })
}

/**
 * Runs `fn` inside a tenant context: sets the transaction-local `app.current_tenant`
 * GUC so row-level security scopes every query — and stamps every insert — to
 * `tenantId`. Use in multi-tenant deployments; single-tenant code can call the db
 * directly (rows default to DEFAULT_TENANT_ID). Fails closed: an empty tenantId is
 * rejected rather than silently widening scope to the default tenant.
 */
const withTenant = <T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> => {
  if (tenantId.trim() === "") {
    throw new Error("withTenant: empty tenantId — refusing to run without a tenant context")
  }
  return db.transaction(async (tx) => {
    // set_config(..., true) = transaction-local, so it can't leak across pooled connections.
    await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`)
    return fn(tx)
  })
}

export { type Transaction, createClient, withTenant }
