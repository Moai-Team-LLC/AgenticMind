// oxlint-disable import/no-unassigned-import
import "@agenticmind/shared/lib/knowledge/_test-env"
import type { Pool } from "pg"

import { createClient } from "@agenticmind/shared/database/client"
import { resolveDatabaseTls } from "@agenticmind/shared/database/tls"
import { execFileSync, spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Database TLS (A5). The resolver is judged on what node-postgres will actually
 * do (the URL's sslmode overrides the pool's `ssl`); the handshake tests run a
 * real TLS handshake against a fake Postgres endpoint (a separate Node process)
 * that presents a self-signed certificate, so "rejected" means the client
 * really refused it — under whichever runtime runs the test.
 */

const URL_PLAIN = "postgres://u:p@db.internal:5432/app"
const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"

describe("resolveDatabaseTls", () => {
  const resolve = (over: Partial<Parameters<typeof resolveDatabaseTls>[0]>) =>
    resolveDatabaseTls({
      profile: "standard",
      ssl: "false",
      ca: undefined,
      databaseUrl: URL_PLAIN,
      ...over,
    })

  it("standard keeps today's behaviour, now with a warning when unverified", () => {
    expect(resolve({})._unsafeUnwrap()).toEqual({ ssl: false, verified: false })
    const on = resolve({ ssl: "true" })._unsafeUnwrap()
    expect(on.ssl).toEqual({ rejectUnauthorized: false })
    expect(on.verified).toBe(false)
    expect(on.warning).toBe(
      "database TLS is on but the server certificate is NOT verified — set DATABASE_SSL_CA (or AGENTICMIND_PROFILE=strict) to verify it",
    )
  })

  it("standard verifies once DATABASE_SSL_CA is set", () => {
    const r = resolve({ ssl: true, ca: PEM })._unsafeUnwrap()
    expect(r).toEqual({ ssl: { rejectUnauthorized: true, ca: PEM }, verified: true })
  })

  it("standard warns when the URL turns verification off", () => {
    const r = resolve({ databaseUrl: `${URL_PLAIN}?sslmode=no-verify` })._unsafeUnwrap()
    expect(r.verified).toBe(false)
    expect(r.warning).toBeDefined()
  })

  it("strict verifies the certificate, with system CAs or DATABASE_SSL_CA", () => {
    expect(resolve({ profile: "strict", ssl: "true" })._unsafeUnwrap()).toEqual({
      ssl: { rejectUnauthorized: true },
      verified: true,
    })
    expect(resolve({ profile: "strict", ssl: "true", ca: PEM })._unsafeUnwrap().ssl).toEqual({
      rejectUnauthorized: true,
      ca: PEM,
    })
    expect(resolve({ profile: "strict" })._unsafeUnwrap()).toEqual({ ssl: false, verified: false })
    expect(
      resolve({
        profile: "strict",
        databaseUrl: `${URL_PLAIN}?sslmode=verify-full`,
      })._unsafeUnwrap().verified,
    ).toBe(true)
  })

  it("strict refuses unverified TLS, including when the URL turns it off", () => {
    for (const q of ["?sslmode=no-verify", "?uselibpqcompat=true&sslmode=require"]) {
      const r = resolve({ profile: "strict", databaseUrl: `${URL_PLAIN}${q}` })
      expect(r._unsafeUnwrapErr(), q).toBe(
        "the database connection uses TLS without verifying the server certificate (sslmode=no-verify or equivalent)",
      )
    }
  })

  it("strict refuses URL TLS parameters next to DATABASE_SSL=true (the URL would win)", () => {
    const r = resolve({
      profile: "strict",
      ssl: "true",
      databaseUrl: `${URL_PLAIN}?sslmode=require`,
    })
    expect(r.isErr()).toBe(true)
  })

  it("an unreadable or non-PEM DATABASE_SSL_CA is an error in both profiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-ca-"))
    const notPem = join(dir, "not.pem")
    writeFileSync(notPem, "hello")
    try {
      for (const profile of ["standard", "strict"] as const) {
        expect(resolve({ profile, ssl: "true", ca: join(dir, "missing.pem") }).isErr()).toBe(true)
        expect(resolve({ profile, ssl: "true", ca: notPem }).isErr()).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

type Fake = { port: number; encryptedBytes: () => number; reset: () => void; close: () => void }

const FIXTURE = fileURLToPath(new URL("fake-tls-postgres.fixture.mjs", import.meta.url))
const NODE = (globalThis as { Bun?: unknown }).Bun !== undefined ? "node" : process.execPath

/** Starts the fake TLS endpoint (a separate Node process, see the fixture). */
const startFakeTlsPostgres = async (keyPath: string, certPath: string): Promise<Fake> => {
  const child = spawn(NODE, [FIXTURE, keyPath, certPath])
  let out = ""
  let mark = 0
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString()
  })
  for (let i = 0; i < 100 && !/listening \d+/u.test(out); i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  }
  const port = Number(/listening (\d+)/u.exec(out)?.[1])
  if (!Number.isInteger(port) || port <= 0) {
    child.kill()
    throw new Error(`fake TLS endpoint did not start: ${out}`)
  }
  const bytesSince = (from: number): number =>
    [...out.slice(from).matchAll(/data (\d+)/gu)].reduce((n, m) => n + Number(m[1]), 0)
  return {
    port,
    encryptedBytes: () => bytesSince(mark),
    reset: () => {
      mark = out.length
    },
    close: () => {
      child.kill()
    },
  }
}

const has = (cmd: string): boolean => {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" })
    return true
  } catch {
    try {
      execFileSync(cmd, ["version"], { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }
}
const hasOpenssl = has("openssl") && has(NODE)

// The handshake tests need openssl and node; in CI their absence is a failure,
// not a silent skip.
// oxlint-disable-next-line node/no-process-env -- CI marker only
it.skipIf(process.env.CI !== "true")("CI has openssl and node for the handshake tests", () => {
  expect(hasOpenssl).toBe(true)
})

describe.skipIf(!hasOpenssl)("database TLS handshake against a self-signed server", () => {
  let dir: string
  let certPem: string
  let fake: Fake

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "am-tls-"))
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
      ],
      { stdio: "ignore" },
    )
    certPem = readFileSync(join(dir, "cert.pem"), "utf8")
    fake = await startFakeTlsPostgres(join(dir, "key.pem"), join(dir, "cert.pem"))
  })

  afterAll(() => {
    fake.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** The fixture reports bytes over stdout; give the last line a moment to arrive. */
  const settledBytes = async (): Promise<number> => {
    await new Promise((resolve) => {
      setTimeout(resolve, 150)
    })
    return fake.encryptedBytes()
  }

  const connect = async (options: Parameters<typeof createClient>[1]) => {
    fake.reset()
    const db = createClient(`postgres://u:p@localhost:${fake.port}/app`, options)
    const pool = (db as unknown as { $client: Pool }).$client
    try {
      const client = await pool.connect()
      client.release()
      return { code: "connected", sent: await settledBytes() }
    } catch (error) {
      return { code: (error as { code?: string }).code ?? "no-code", sent: await settledBytes() }
    } finally {
      await pool.end().catch(() => {
        // Pool already torn down by the failed connect.
      })
    }
  }

  it("strict rejects a certificate it cannot verify — nothing is sent", async () => {
    const r = await connect({ profile: "strict", ssl: "true" })
    expect(r).toEqual({ code: "DEPTH_ZERO_SELF_SIGNED_CERT", sent: 0 })
  })

  it("strict connects once that certificate's CA is supplied (control)", async () => {
    const r = await connect({ profile: "strict", ssl: "true", ca: certPem })
    expect(r.code).not.toBe("DEPTH_ZERO_SELF_SIGNED_CERT")
    expect(r.sent, "encrypted startup message reached the server").toBeGreaterThan(0)
  })

  it("standard still accepts it unverified, as before (with a warning)", async () => {
    const r = await connect({ profile: "standard", ssl: "true" })
    expect(r.sent, "encrypted startup message reached the server").toBeGreaterThan(0)
  })

  it("strict refuses to even build a pool on an unverified URL setting", () => {
    expect(() =>
      createClient(`postgres://u:p@localhost:${fake.port}/app?sslmode=no-verify`, {
        profile: "strict",
        ssl: "false",
      }),
    ).toThrow(
      "database TLS: the database connection uses TLS without verifying the server certificate (sslmode=no-verify or equivalent)",
    )
  })
})
