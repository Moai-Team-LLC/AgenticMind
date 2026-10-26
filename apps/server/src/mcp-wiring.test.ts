// oxlint-disable node/no-process-env -- builds the child process environment
import type { ChildProcess } from "node:child_process"

import { spawn } from "node:child_process"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * The input limits as the real server wires them (index.ts → mcp.ts): the body
 * cap sits in front of auth, and the element cap reaches the McpServer that
 * mcp-handler builds. mcp-limits.test.ts proves the pieces; this proves the
 * assembly. Needs no database: auth uses the static key and neither tools/list
 * nor a refused call opens a connection.
 */

const SERVER_DIR = fileURLToPath(new URL("../", import.meta.url))
const KEY = "wiring-test-key-0123456789abcdef"
const PORT = 41_000 + Math.floor(Math.random() * 900)
const URL_MCP = `http://127.0.0.1:${PORT}/mcp`

let child: ChildProcess
let output = ""

beforeAll(async () => {
  const bun = (globalThis as { Bun?: unknown }).Bun !== undefined ? process.execPath : "bun"
  child = spawn(bun, ["src/index.ts"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DATABASE_URL: "postgres://wiring:test@127.0.0.1:1/none",
      SKIP_VALIDATION: "true",
      AGENTICMIND_PROFILE: "standard",
      MCP_API_KEY: KEY,
      MCP_MAX_REQUEST_BODY_BYTES: "4096",
      MCP_MAX_TOOL_INPUT_ELEMENTS: "100",
      PORT: String(PORT),
    },
  })
  const listening = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server did not start:\n${output}`))
    }, 30_000)
    const onData = (chunk: Buffer): void => {
      output += chunk.toString()
      if (output.includes("listening on")) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)
    child.on("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited (${String(code)}):\n${output}`))
    })
  })
  await listening
}, 60_000)

afterAll(async () => {
  if (child.exitCode === null) {
    const exited = once(child, "exit")
    child.kill("SIGTERM")
    await exited
  }
})

const rpc = async (body: string, auth: boolean): Promise<Response> =>
  fetch(URL_MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(auth ? { authorization: `Bearer ${KEY}` } : {}),
    },
    body,
  })

const resultOf = async (
  res: Response,
): Promise<{ isError?: boolean; content?: { text: string }[]; tools?: { name: string }[] }> => {
  const text = await res.text()
  const data = text.split("\n").find((l) => l.startsWith("data: "))
  return (JSON.parse(data === undefined ? text : data.slice("data: ".length)) as { result: never })
    .result
}

const call = (id: number, method: string, params: unknown): string =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params })

describe("MCP input limits, as the server wires them", () => {
  it("logs the effective limits at boot", () => {
    expect(output).toContain(
      "[SERVER] MCP limits: request body ≤ 4096 bytes, tool input ≤ 100 elements",
    )
  })

  it("an over-cap body is refused 413 before auth", async () => {
    const big = call(1, "tools/list", { pad: "x".repeat(8000) })
    const res = await rpc(big, false)
    expect(res.status).toBe(413)
  })

  it("control: a small unauthenticated body reaches auth and gets 401", async () => {
    const res = await rpc(call(2, "tools/list", {}), false)
    expect(res.status).toBe(401)
  })

  it("an over-cap tool call is refused before its schema runs", async () => {
    const queries = Array.from({ length: 500 }, (_, i) => `q${i}`)
    const res = await rpc(
      call(3, "tools/call", { name: "kl_search", arguments: { q: "x", queries } }),
      true,
    )
    expect(res.status).toBe(200)
    const result = await resultOf(res)
    expect(result.isError).toBe(true)
    expect(result.content?.[0]?.text).toBe(
      "MCP error -32602: Invalid arguments for tool kl_search: arguments contain more than the maximum of 100 elements",
    )
  })

  it("control: an authenticated tools/list within the caps is served", async () => {
    const res = await rpc(call(4, "tools/list", {}), true)
    expect(res.status).toBe(200)
    const names = ((await resultOf(res)).tools ?? []).map((t) => t.name)
    expect(names, `tools: ${names.join(", ")}`).toContain("kl_search")
  })
})
