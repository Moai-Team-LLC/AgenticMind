/**
 * Database role check — does row-level security actually apply to the role the
 * process connects as?
 *
 * Superusers and BYPASSRLS roles skip every RLS policy, so a deployment whose
 * DATABASE_URL logs in as the bootstrap superuser has tenant isolation switched
 * off without any error. `SET LOCAL ROLE` (DATABASE_APP_ROLE) only covers queries
 * inside `withTenant`; token lookups and other direct queries still run as the
 * login role. The strict profile therefore requires the LOGIN role itself to be
 * neither a superuser nor BYPASSRLS, and refuses to start otherwise.
 *
 * `readDatabaseRoleFacts` reads the facts; `evaluateDatabaseRole` is the pure
 * decision, unit-testable with canned facts.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { DatabaseError } from "@agenticmind/shared/database/database-error"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type RoleFacts = {
  name: string
  exists: boolean
  superuser: boolean
  bypassRls: boolean
}

export type DatabaseRoleFacts = {
  /** The role the connection logged in as (`current_user`). */
  login: RoleFacts
  /** DATABASE_APP_ROLE, when configured. */
  appRole?: RoleFacts
}

type RoleRow = { name: string; superuser: boolean; bypass_rls: boolean }

const toFacts = (name: string, row: RoleRow | undefined): RoleFacts =>
  row === undefined
    ? { name, exists: false, superuser: false, bypassRls: false }
    : { name: row.name, exists: true, superuser: row.superuser, bypassRls: row.bypass_rls }

const queryFacts = async (
  tx: Transaction,
  appRole: string | undefined,
): Promise<DatabaseRoleFacts> => {
  const login = await tx.execute<RoleRow & { login: string }>(sql`
    select current_user::text as login, r.rolname::text as name,
           r.rolsuper as superuser, r.rolbypassrls as bypass_rls
    from pg_roles r where r.rolname = current_user`)
  const loginName = login.rows[0]?.login ?? "(unknown)"
  const facts: DatabaseRoleFacts = { login: toFacts(loginName, login.rows[0]) }
  if (appRole !== undefined && appRole !== "") {
    const app = await tx.execute<RoleRow>(sql`
      select rolname::text as name, rolsuper as superuser, rolbypassrls as bypass_rls
      from pg_roles where rolname = ${appRole}`)
    facts.appRole = toFacts(appRole, app.rows[0])
  }
  return facts
}

/** Reads the login role (and DATABASE_APP_ROLE, if given) from `pg_roles`. */
export const readDatabaseRoleFacts = (
  tx: Transaction,
  appRole?: string,
): ResultAsync<DatabaseRoleFacts, DatabaseError> =>
  ResultAsync.fromPromise(queryFacts(tx, appRole), (e) => mapDatabaseError(e))

const bypassReasons = (role: RoleFacts, label: string): string[] => {
  const reasons: string[] = []
  if (role.superuser) {
    reasons.push(`${label} "${role.name}" is a superuser, so row-level security does not apply`)
  }
  if (role.bypassRls) {
    reasons.push(`${label} "${role.name}" has BYPASSRLS, so row-level security does not apply`)
  }
  return reasons
}

/**
 * The strict-profile decision. Returns the reasons to refuse; empty = OK.
 * Pure: no I/O.
 */
export const evaluateDatabaseRole = (facts: DatabaseRoleFacts): string[] => {
  const reasons = bypassReasons(facts.login, "database login role")
  if (facts.appRole !== undefined) {
    if (!facts.appRole.exists) {
      reasons.push(`DATABASE_APP_ROLE "${facts.appRole.name}" does not exist`)
    } else {
      reasons.push(...bypassReasons(facts.appRole, "DATABASE_APP_ROLE"))
    }
  }
  return reasons
}
