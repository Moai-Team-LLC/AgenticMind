// oxlint-disable node/no-process-env
// oxlint-disable import/no-unassigned-import
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { DatabaseRoleFacts } from "@agenticmind/shared/database/role-check"

import { createClient, withTenant } from "@agenticmind/shared/database/client"
import {
  evaluateDatabaseRole,
  readDatabaseRoleFacts,
} from "@agenticmind/shared/database/role-check"
import { sql } from "drizzle-orm"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Strict-profile database role check (A2).
 *
 * Unit part: the pure decision over canned facts. Integration part (needs a
 * migrated DATABASE_URL, as in CI): a least-privilege LOGIN role that is a
 * member of `agenticmind_app` passes the check and is actually isolated per
 * tenant, while the bootstrap superuser fails it — and the real server process
 * refuses to start on it in the strict profile.
 */

const role = (name: string, over: Partial<DatabaseRoleFacts["login"]> = {}) => {
  return { name, exists: true, superuser: false, bypassRls: false, ...over }
}

describe("evaluateDatabaseRole", () => {
  it("accepts a plain login role", () => {
    expect(evaluateDatabaseRole({ login: role("app") })).toEqual([])
  })

  it("refuses a superuser or BYPASSRLS login role", () => {
    expect(evaluateDatabaseRole({ login: role("postgres", { superuser: true }) })).toEqual([
      'database login role "postgres" is a superuser, so row-level security does not apply',
    ])
    expect(evaluateDatabaseRole({ login: role("owner", { bypassRls: true }) })).toEqual([
      'database login role "owner" has BYPASSRLS, so row-level security does not apply',
    ])
  })

  it("refuses a missing or privileged DATABASE_APP_ROLE", () => {
    expect(
      evaluateDatabaseRole({ login: role("app"), appRole: role("ghost", { exists: false }) }),
    ).toEqual(['DATABASE_APP_ROLE "ghost" does not exist'])
    expect(
      evaluateDatabaseRole({ login: role("app"), appRole: role("admin", { superuser: true }) }),
    ).toEqual(['DATABASE_APP_ROLE "admin" is a superuser, so row-level security does not apply'])
  })
})

const DB_URL = process.env.DATABASE_URL ?? ""
const LOGIN_ROLE = "am_strict_login_test"
const LOGIN_PW = "am_strict_login_pw"
const TENANT_A = "33333333-3333-3333-3333-333333333333"
const TENANT_B = "44444444-4444-4444-4444-444444444444"
const MARKER = "__strict_role_probe__"
const SERVER_DIR = fileURLToPath(new URL("../../../../apps/server/", import.meta.url))

const asLoginRole = (base: string): string => {
  const u = new URL(base)
  u.username = LOGIN_ROLE
  u.password = LOGIN_PW
  return u.toString()
}

type BootResult = { code: number | null; output: string; served: boolean }

/** Starts the real server entry point and reports whether it began serving. */
const bootServer = async (databaseUrl: string): Promise<BootResult> => {
  const bun = (globalThis as { Bun?: unknown }).Bun !== undefined ? process.execPath : "bun"
  const child = spawn(bun, ["src/index.ts"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AGENTICMIND_PROFILE: "strict",
      SKIP_VALIDATION: "true",
      PORT: String(39_000 + Math.floor(Math.random() * 900)),
    },
  })
  let output = ""
  let served = false
  const timer = setTimeout(() => {
    child.kill("SIGKILL")
  }, 30_000)
  const onData = (chunk: Buffer): void => {
    output += chunk.toString()
    if (!served && output.includes("listening on")) {
      served = true
      child.kill("SIGTERM")
    }
  }
  child.stdout.on("data", onData)
  child.stderr.on("data", onData)
  const [code] = (await once(child, "exit")) as [number | null]
  clearTimeout(timer)
  return { code, output, served }
}

describe.skipIf(DB_URL === "")("strict database role (real Postgres)", () => {
  let admin: ReturnType<typeof createClient>
  let app: ReturnType<typeof createClient>

  beforeAll(async () => {
    admin = createClient(DB_URL)
    await admin.execute(
      sql.raw(`
      do $$ begin
        if exists (select from pg_roles where rolname = '${LOGIN_ROLE}') then
          execute 'drop owned by ${LOGIN_ROLE}';
          execute 'drop role ${LOGIN_ROLE}';
        end if;
      end $$`),
    )
    // The production shape: a LOGIN role that inherits agenticmind_app (0004).
    await admin.execute(
      sql.raw(
        `create role ${LOGIN_ROLE} login password '${LOGIN_PW}' nosuperuser nobypassrls in role agenticmind_app`,
      ),
    )
    await admin.execute(sql`delete from beliefs where subject = ${MARKER}`)
    app = createClient(asLoginRole(DB_URL))
  })

  afterAll(async () => {
    await (app as unknown as { $client: { end: () => Promise<void> } }).$client.end()
    await admin.execute(sql`delete from beliefs where subject = ${MARKER}`)
    await admin.execute(sql.raw(`drop owned by ${LOGIN_ROLE}`))
    await admin.execute(sql.raw(`drop role if exists ${LOGIN_ROLE}`))
    await (admin as unknown as { $client: { end: () => Promise<void> } }).$client.end()
  })

  it("refuses the bootstrap superuser", async () => {
    const facts = (await readDatabaseRoleFacts(admin))._unsafeUnwrap()
    expect(facts.login.superuser).toBe(true)
    expect(evaluateDatabaseRole(facts).length).toBeGreaterThan(0)
  })

  it("accepts the least-privilege login role, and isolates tenants through it", async () => {
    const facts = (await readDatabaseRoleFacts(app, "agenticmind_app"))._unsafeUnwrap()
    expect(facts.login).toEqual({
      name: LOGIN_ROLE,
      exists: true,
      superuser: false,
      bypassRls: false,
    })
    expect(evaluateDatabaseRole(facts)).toEqual([])

    await withTenant(app, TENANT_A, async (tx) => {
      await tx.execute(sql`insert into beliefs (subject, predicate, object, object_tsv)
        values (${MARKER}, 'p', 'o', to_tsvector('simple', 'o'))`)
    })
    const count = async (tenant: string) =>
      withTenant(app, tenant, async (tx) => {
        const r = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from beliefs where subject = ${MARKER}`,
        )
        return r.rows[0]?.n ?? -1
      })
    // Positive control: the writer sees its own row; the other tenant sees none.
    expect(await count(TENANT_A)).toBe(1)
    expect(await count(TENANT_B)).toBe(0)
  })

  it("the server refuses to start in strict as superuser, and starts as the app role", async () => {
    const refused = await bootServer(DB_URL)
    expect(refused.served, refused.output).toBe(false)
    expect(refused.code, refused.output).toBe(1)
    expect(refused.output).toContain("is a superuser, so row-level security does not apply")
    expect(refused.output).toContain("refusing to start")

    const started = await bootServer(asLoginRole(DB_URL))
    expect(started.served, started.output).toBe(true)
    expect(started.output).toContain(
      `database role "${LOGIN_ROLE}" is subject to row-level security`,
    )
  }, 60_000)
})
