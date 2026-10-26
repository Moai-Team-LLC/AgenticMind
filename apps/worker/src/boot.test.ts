// oxlint-disable node/no-process-env -- builds the child process environment
import { spawn } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The worker's boot refusals, on the real entry point. Its job modules open the
 * database pool when they load, so a refusal must happen before they do — and
 * read as a clean `[WORKER] … refusing to start`, not a stack trace from an
 * import.
 */

const WORKER_DIR = fileURLToPath(new URL("../", import.meta.url))

type Boot = { code: number | null; output: string; ready: boolean }

const boot = async (env: Record<string, string>): Promise<Boot> => {
  const bun = (globalThis as { Bun?: unknown }).Bun !== undefined ? process.execPath : "bun"
  const child = spawn(bun, ["src/index.ts"], {
    cwd: WORKER_DIR,
    env: {
      ...process.env,
      // Never reached by the refusal cases; the control only needs the boot line.
      DATABASE_URL: "postgres://boot:test@127.0.0.1:1/none",
      SKIP_VALIDATION: "true",
      ...env,
    },
  })
  let output = ""
  let ready = false
  const timer = setTimeout(() => {
    child.kill("SIGKILL")
  }, 30_000)
  const onData = (chunk: Buffer): void => {
    output += chunk.toString()
    if (!ready && output.includes("AgenticMind worker ready")) {
      ready = true
      child.kill("SIGTERM")
    }
  }
  child.stdout.on("data", onData)
  child.stderr.on("data", onData)
  const [code] = (await once(child, "exit")) as [number | null]
  clearTimeout(timer)
  return { code, output, ready }
}

const lines = (output: string): string[] => output.split("\n").map((l) => l.trim())

describe("worker boot", () => {
  it("an unknown AGENTICMIND_PROFILE refuses with a clean line, before any job loads", async () => {
    const r = await boot({ AGENTICMIND_PROFILE: "Strict" })
    expect(r.code, r.output).toBe(1)
    expect(lines(r.output), r.output).toContain(
      '[WORKER] AGENTICMIND_PROFILE="Strict" is not one of: standard, strict — refusing to start',
    )
  }, 60_000)

  it("strict refuses unverified database TLS with a clean line, not an import stack trace", async () => {
    const r = await boot({
      AGENTICMIND_PROFILE: "strict",
      DATABASE_URL: "postgres://boot:test@127.0.0.1:1/none?sslmode=no-verify",
    })
    expect(r.code, r.output).toBe(1)
    expect(lines(r.output), r.output).toContain(
      "[WORKER] database TLS: the database connection uses TLS without verifying the server certificate (sslmode=no-verify, ssl=no-verify or equivalent) — refusing to start",
    )
  }, 60_000)

  it("control: a valid profile gets past the checks and schedules the jobs", async () => {
    const r = await boot({ AGENTICMIND_PROFILE: "standard" })
    expect(r.ready, r.output).toBe(true)
    expect(lines(r.output), r.output).toContain("[WORKER] profile: standard")
  }, 60_000)
})
