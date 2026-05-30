import type { schema } from "@agenticmind/shared/database/schema"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import { createClient } from "@agenticmind/shared/database/client"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"

export const db: NodePgDatabase<typeof schema> = createClient(databaseSettings.DATABASE_URL)
