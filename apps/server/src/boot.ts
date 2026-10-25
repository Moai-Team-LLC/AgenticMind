/**
 * Strict-profile boot checks. Each check either logs what it verified or returns
 * a refusal; index.ts refuses to start on any refusal. Nothing here runs in the
 * standard profile, so standard deployments see no new queries or failures at
 * boot.
 */

import {
  evaluateDatabaseRole,
  readDatabaseRoleFacts,
} from "@agenticmind/shared/database/role-check"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"

import { getDb } from "@/server/lib/database"

/** The database login role must be subject to row-level security. */
const checkDatabaseRole = async (): Promise<string[]> => {
  const facts = await readDatabaseRoleFacts(getDb(), databaseSettings.DATABASE_APP_ROLE)
  if (facts.isErr()) {
    // Could not measure is not the same as measured-and-fine: refuse.
    return [`could not verify the database role: ${facts.error.message}`]
  }
  const reasons = evaluateDatabaseRole(facts.value)
  if (reasons.length === 0) {
    console.log(
      `[SERVER] strict: database role "${facts.value.login.name}" is subject to row-level security`,
    )
  }
  return reasons
}

/** Runs every strict boot check; returns all refusals (empty = start). */
export const strictBootRefusals = async (): Promise<string[]> => [...(await checkDatabaseRole())]
