import type { schema } from "@agenticmind/shared/database/schema"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import { createClient } from "@agenticmind/shared/database/client"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"

// HMR-safe singleton: Next dev reloads modules on every edit, so cache the
// pool on globalThis to avoid exhausting Postgres connections.
declare global {
  // eslint-disable-next-line no-var
  var __agenticmindDb: NodePgDatabase<typeof schema> | undefined
}

export const getDb = (): NodePgDatabase<typeof schema> => {
  if (globalThis.__agenticmindDb === undefined) {
    console.log("[DATABASE] Creating database client")
    globalThis.__agenticmindDb = createClient(databaseSettings.DATABASE_URL)
  }
  return globalThis.__agenticmindDb
}
