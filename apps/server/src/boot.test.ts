// oxlint-disable node/no-process-env -- builds the child process environment
import { spawn } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Boot checks that need no database, exercised on the real server entry point.
 * A malformed KNOWLEDGE_ANSWER_POLICY must stop a strict server before it
 * serves, and must keep being ignored by a standard one (today's behaviour).
 */

const SERVER_DIR = fileURLToPath(new URL("../", import.meta.url))

type Boot = { code: number | null; output: string; served: boolean }

const boot = async (env: Record<string, string>): Promise<Boot> => {
  const bun = (globalThis as { Bun?: unknown }).Bun !== undefined ? process.execPath : "bun"
  const child = spawn(bun, ["src/index.ts"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      // Never reached: every case here is decided before the first query.
      DATABASE_URL: "postgres://boot:test@127.0.0.1:1/none",
      SKIP_VALIDATION: "true",
      PORT: String(40_000 + Math.floor(Math.random() * 900)),
      ...env,
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

const MALFORMED = '{"minGroundedness":0.8,'

describe("server boot — answer policy (A6)", () => {
  it("strict refuses to start on a malformed KNOWLEDGE_ANSWER_POLICY", async () => {
    const r = await boot({ AGENTICMIND_PROFILE: "strict", KNOWLEDGE_ANSWER_POLICY: MALFORMED })
    expect(r.served, r.output).toBe(false)
    expect(r.code, r.output).toBe(1)
    expect(r.output).toContain(
      "[SERVER] strict: KNOWLEDGE_ANSWER_POLICY is invalid — not valid JSON",
    )
    expect(r.output).toContain("boot checks failed — refusing to start")
  }, 60_000)

  it("strict refuses a policy that parses but breaks the schema", async () => {
    const r = await boot({
      AGENTICMIND_PROFILE: "strict",
      KNOWLEDGE_ANSWER_POLICY: '{"minGroundedness":2}',
    })
    expect(r.code, r.output).toBe(1)
    expect(r.output).toContain("KNOWLEDGE_ANSWER_POLICY is invalid — minGroundedness:")
  }, 60_000)

  it("standard still starts and ignores it, as before (control)", async () => {
    const r = await boot({ AGENTICMIND_PROFILE: "standard", KNOWLEDGE_ANSWER_POLICY: MALFORMED })
    expect(r.served, r.output).toBe(true)
    expect(r.output).not.toContain("KNOWLEDGE_ANSWER_POLICY")
  }, 60_000)
})
