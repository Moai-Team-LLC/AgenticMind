import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import { schema } from "@agenticmind/shared/database/schema"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"
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

export { type Transaction, createClient }
