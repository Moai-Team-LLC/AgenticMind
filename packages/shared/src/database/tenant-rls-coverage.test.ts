// oxlint-disable node/no-process-env
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import; must run before settings
import "@agenticmind/shared/lib/knowledge/_test-env"
import { createClient } from "@agenticmind/shared/database/client"
import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Every table that carries a `tenant_id` must have row-level security enabled
 * and the `tenant_isolation` policy — read from the migrated catalog, not from
 * a list in this file, so a new tenant table without a policy fails here.
 */

/** Tenant tables deliberately without RLS, each with its reason. */
const EXEMPT: Record<string, string> = {
  mcp_tokens:
    "looked up by token id to learn the caller's tenant, before any tenant context exists",
}

const DB_URL = process.env.DATABASE_URL ?? ""

describe.skipIf(DB_URL === "")("tenant tables carry row-level security", () => {
  let db: ReturnType<typeof createClient>
  beforeAll(() => {
    db = createClient(DB_URL)
  })
  afterAll(async () => {
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  })

  it("enabled with the tenant_isolation policy on every tenant_id table", async () => {
    const res = await db.execute(sql`
      select c.relname as name, c.relrowsecurity as rls,
        exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'tenant_isolation') as policy
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `)
    const rows = res.rows as { name: string; rls: boolean; policy: boolean }[]
    const names = rows.map((r) => r.name)
    expect(names.length, `tenant tables: ${names.join(", ")}`).toBeGreaterThan(0)
    expect(names).toContain("materials")
    const uncovered = rows
      .filter((r) => !(r.name in EXEMPT) && !(r.rls && r.policy))
      .map((r) => `${r.name} (rls=${String(r.rls)}, policy=${String(r.policy)})`)
    expect(uncovered).toEqual([])
    expect(Object.keys(EXEMPT).filter((t) => !names.includes(t))).toEqual([])
  })
})
