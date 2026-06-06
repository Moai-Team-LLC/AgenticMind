// oxlint-disable node/no-process-env
// oxlint-disable import/no-unassigned-import
import "./_test-env"
import type { PoolClient } from "pg"

import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Cross-tenant leakage eval (Agentic Product Standard v2.0, DoD 14) — a
 * code-asserted check that the `tenant_isolation` RLS policy (migration 0003)
 * actually isolates tenants.
 *
 * Why a dedicated role: superusers and table owners BYPASS row-level security, so
 * the default `postgres` connection would show every tenant's rows and prove
 * nothing. The test provisions a NON-superuser role, connects as it, and asserts
 * the policy both hides another tenant's rows (USING) and refuses a cross-tenant
 * write (WITH CHECK). This also documents the production requirement: enforcement
 * only holds when the app connects as a non-superuser role.
 */

const DB_URL = process.env.DATABASE_URL ?? ""
const RLS_USER = "rls_isolation_test"
const RLS_PW = "rls_isolation_pw"
const TENANT_A = "11111111-1111-1111-1111-111111111111"
const TENANT_B = "22222222-2222-2222-2222-222222222222"
const MARKER = "__rls_isolation_probe__"

const asRlsUser = (base: string): string => {
  const u = new URL(base)
  u.username = RLS_USER
  u.password = RLS_PW
  return u.toString()
}

const cleanupErrors: unknown[] = []
/** Best-effort cleanup: await `p`, swallowing any error (never asserted). */
const quiet = async (p: Promise<unknown>): Promise<void> => {
  try {
    await p
  } catch (error) {
    cleanupErrors.push(error)
  }
}

/** Run `fn` in a transaction with the tenant GUC set — mirrors `withTenant`. */
const inTenant = async <T>(
  pool: Pool,
  tenant: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> => {
  const c = await pool.connect()
  try {
    await c.query("BEGIN")
    await c.query("SELECT set_config('app.current_tenant', $1, true)", [tenant])
    const result = await fn(c)
    await c.query("COMMIT")
    return result
  } catch (error) {
    await quiet(c.query("ROLLBACK"))
    throw error
  } finally {
    c.release()
  }
}

describe.skipIf(DB_URL === "")("tenant isolation (RLS policy)", () => {
  let admin: Pool
  let app: Pool

  beforeAll(async () => {
    admin = new Pool({ connectionString: DB_URL })
    // Recreate the non-superuser role from a clean slate (drop its grants first
    // so DROP ROLE has no dependents), then grant the minimum to touch beliefs.
    await admin.query(`
      do $$ begin
        if exists (select from pg_roles where rolname = '${RLS_USER}') then
          execute 'drop owned by ${RLS_USER}';
          execute 'drop role ${RLS_USER}';
        end if;
      end $$;
    `)
    await admin.query(`create role ${RLS_USER} login password '${RLS_PW}' nosuperuser`)
    await admin.query(`grant usage on schema public to ${RLS_USER}`)
    await admin.query(`grant select, insert on beliefs to ${RLS_USER}`)
    await admin.query("delete from beliefs where subject = $1", [MARKER])
    app = new Pool({ connectionString: asRlsUser(DB_URL) })
  })

  afterAll(async () => {
    await quiet(app.end())
    await quiet(admin.query("delete from beliefs where subject = $1", [MARKER]))
    await quiet(admin.query(`drop owned by ${RLS_USER}`))
    await quiet(admin.query(`drop role if exists ${RLS_USER}`))
    await quiet(admin.end())
  })

  it("hides another tenant's rows and refuses cross-tenant writes", async () => {
    // Tenant A writes a belief — tenant_id is stamped from the GUC by the column default.
    await inTenant(app, TENANT_A, async (c) => {
      await c.query(
        `insert into beliefs (subject, predicate, object, object_tsv)
         values ($1, 'p', 'o', to_tsvector('simple', 'o'))`,
        [MARKER],
      )
    })

    // Positive control: tenant A sees its own row.
    const seenByA = await inTenant(app, TENANT_A, async (c) =>
      (await c.query<{ n: number }>("select count(*)::int as n from beliefs where subject = $1", [MARKER]))
        .rows[0]?.n ?? 0,
    )
    expect(seenByA).toBe(1)

    // Isolation (USING): tenant B cannot see tenant A's row.
    const seenByB = await inTenant(app, TENANT_B, async (c) =>
      (await c.query<{ n: number }>("select count(*)::int as n from beliefs where subject = $1", [MARKER]))
        .rows[0]?.n ?? 0,
    )
    expect(seenByB).toBe(0)

    // Isolation (WITH CHECK): tenant B cannot write a row tagged for tenant A.
    await expect(
      inTenant(app, TENANT_B, async (c) => {
        await c.query(
          `insert into beliefs (tenant_id, subject, predicate, object, object_tsv)
           values ($1, $2, 'p', 'o', to_tsvector('simple', 'o'))`,
          [TENANT_A, MARKER],
        )
      }),
    ).rejects.toThrow()
  })
})
