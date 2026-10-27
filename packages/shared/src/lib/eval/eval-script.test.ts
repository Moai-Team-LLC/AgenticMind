// oxlint-disable node/no-process-env -- builds the child process environment
import { spawn } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The gate decisions of scripts/eval.ts, exercised on the real script. Restricted to
 * prompt_injection, every case is blocked by the input guard before the engine is
 * called, so a run needs no database, no model and no key, and spends nothing — the
 * closing "Usage: 0 tokens" line proves no model call returned.
 */

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url))
// Never reach a provider, and never write into a CI job summary, from a unit test.
const STRIPPED = new Set(["CHAT_API_KEY", "OPENAI_API_KEY", "GITHUB_STEP_SUMMARY"])

type Run = { code: number | null; lines: string[] }

const runEval = async (env: Record<string, string>): Promise<Run> => {
  const bun = (globalThis as { Bun?: unknown }).Bun !== undefined ? process.execPath : "bun"
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !STRIPPED.has(k)),
  )
  const child = spawn(bun, ["scripts/eval.ts"], {
    cwd: ROOT,
    env: {
      ...inherited,
      DATABASE_URL: "postgres://eval:test@127.0.0.1:1/none",
      SKIP_VALIDATION: "true",
      ...env,
    },
  })
  let output = ""
  const timer = setTimeout(() => {
    child.kill("SIGKILL")
  }, 60_000)
  const onData = (chunk: Buffer): void => {
    output += chunk.toString()
  }
  child.stdout.on("data", onData)
  child.stderr.on("data", onData)
  const [code] = (await once(child, "exit")) as [number | null]
  clearTimeout(timer)
  return { code, lines: output.split("\n").map((l) => l.trimEnd()) }
}

const NO_SPEND = "Usage: 0 tokens (0 in / 0 out) over 0 calls · no model call returned"

describe("scripts/eval.ts — floors under EVAL_ONLY", () => {
  it("skips the floor of a mode the run does not select, and says so", async () => {
    const r = await runEval({
      EVAL_ONLY: "prompt_injection",
      BASELINE_MODE_FLOORS: '{"faithfulness":0.8}',
    })
    expect(r.code, r.lines.join("\n")).toBe(0)
    expect(r.lines).toContain(
      "  faithfulness: floor 80% not applied — mode not selected by EVAL_ONLY",
    )
    expect(r.lines).toContain("Eval gate passed.")
    expect(r.lines).toContain(NO_SPEND)
  }, 90_000)

  it("still applies the floor of a mode it selects (control)", async () => {
    const r = await runEval({
      EVAL_ONLY: "prompt_injection",
      BASELINE_MODE_FLOORS: '{"faithfulness":0.8,"prompt_injection":1}',
    })
    expect(r.code, r.lines.join("\n")).toBe(0)
    expect(r.lines).toContain("  prompt_injection: 54/54 (100%) · floor 100%")
    expect(r.lines).toContain(
      "  faithfulness: floor 80% not applied — mode not selected by EVAL_ONLY",
    )
  }, 90_000)

  it("refuses an EVAL_ONLY mode no case has — a typo must not run zero cases and pass", async () => {
    const r = await runEval({ EVAL_ONLY: "faithfulnes" })
    expect(r.code, r.lines.join("\n")).toBe(2)
    const refusal = r.lines.filter((l) =>
      l.startsWith('eval gate NOT RUN — EVAL_ONLY names "faithfulnes", which no case has'),
    )
    expect(refusal, r.lines.join("\n")).toHaveLength(1)
    expect(
      r.lines.some((l) => l.startsWith("Eval:")),
      "the suite must not run",
    ).toBe(false)
  }, 90_000)
})
