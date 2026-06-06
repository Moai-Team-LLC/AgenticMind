// oxlint-disable node/no-process-env
// oxlint-disable import/no-unassigned-import
// oxlint-disable typescript/no-explicit-any
import "./_test-env"
import { createClient } from "@agenticmind/shared/database/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Verifies the production multi-tenant RLS mechanism end-to-end: migration 0004
 * provisions a least-privilege `agenticmind_app` role, and downgrading a
 * superuser connection to it via `SET ROLE` makes the tenant_isolation policy
 * (0003) actually enforce — both the USING read filter and the WITH CHECK write
 * guard. This is the exact path withTenant() takes when DATABASE_APP_ROLE is set.
 *
 * Skipped without a DATABASE_URL (unit-only runs). In CI the DB is migrated
 * before tests, so the role and its grants exist.
 */
const APP_ROLE = "agenticmind_app"
const TENANT_A = "11111111-1111-1111-1111-111111111111"
const TENANT_B = "22222222-2222-2222-2222-222222222222"

describe.skipIf(process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === "")(
  "tenant app role (RLS enforced via SET ROLE)",
  () => {
    let db: ReturnType<typeof createClient>
    let pool: any

    beforeAll(() => {
      db = createClient(process.env.DATABASE_URL!)
      pool = (db as any).$client
    })

    afterAll(async () => {
      await pool.end()
    })

    it("provisions a non-superuser, NOLOGIN, NOBYPASSRLS role", async () => {
      const { rows } = await pool.query(
        "select rolsuper, rolcanlogin, rolbypassrls from pg_roles where rolname = $1",
        [APP_ROLE],
      )
      expect(rows.length).toBe(1)
      expect(rows[0].rolsuper).toBe(false)
      expect(rows[0].rolcanlogin).toBe(false)
      expect(rows[0].rolbypassrls).toBe(false)
    })

    it("grants the role read + write on tenant tables", async () => {
      const { rows } = await pool.query(
        `select has_table_privilege($1, 'beliefs', 'SELECT') as can_select,
                has_table_privilege($1, 'beliefs', 'INSERT') as can_insert`,
        [APP_ROLE],
      )
      expect(rows[0].can_select).toBe(true)
      expect(rows[0].can_insert).toBe(true)
    })

    it("hides other tenants' rows and refuses cross-tenant writes once downgraded", async () => {
      const client = await pool.connect()
      try {
        await client.query("begin")
        await client.query(`set local role ${APP_ROLE}`)

        // Tenant A writes a belief; tenant_id defaults from the GUC.
        await client.query("select set_config('app.current_tenant', $1, true)", [TENANT_A])
        await client.query(
          `insert into beliefs (subject, predicate, object, object_tsv)
           values ('s', 'p', 'secret-a', to_tsvector('simple', 'secret-a'))`,
        )
        const ownView = await client.query(
          "select count(*)::int as n from beliefs where object = 'secret-a'",
        )
        expect(ownView.rows[0].n).toBe(1)

        // Tenant B cannot see A's row (USING filter).
        await client.query("select set_config('app.current_tenant', $1, true)", [TENANT_B])
        const crossView = await client.query(
          "select count(*)::int as n from beliefs where object = 'secret-a'",
        )
        expect(crossView.rows[0].n).toBe(0)

        // Tenant B cannot forge a row stamped for A (WITH CHECK guard).
        await expect(
          client.query(
            `insert into beliefs (tenant_id, subject, predicate, object, object_tsv)
             values ($1, 's', 'p', 'cross', to_tsvector('simple', 'cross'))`,
            [TENANT_A],
          ),
        ).rejects.toThrow()
      } finally {
        await client.query("rollback")
        client.release()
      }
    })
  },
)
