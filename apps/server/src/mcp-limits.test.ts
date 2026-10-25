// oxlint-disable import/no-unassigned-import
import "@agenticmind/shared/lib/knowledge/_test-env"
import { createMcpHandler } from "mcp-handler"
import { describe, expect, it } from "vitest"
import * as z from "zod"

import {
  mcpServerLimitOptions,
  resolveMcpLimits,
  STRICT_MAX_REQUEST_BODY_BYTES,
  STRICT_MAX_TOOL_INPUT_ELEMENTS,
  withRequestBodyLimit,
} from "./mcp-limits"

describe("resolveMcpLimits", () => {
  it("standard has no limits unless configured", () => {
    expect(resolveMcpLimits("standard", {})._unsafeUnwrap()).toEqual({})
    expect(
      resolveMcpLimits("standard", {
        maxRequestBodyBytes: "4096",
        maxToolInputElements: "",
      })._unsafeUnwrap(),
    ).toEqual({ maxRequestBodyBytes: 4096 })
  })

  it("strict applies the defaults, and env overrides them", () => {
    expect(resolveMcpLimits("strict", {})._unsafeUnwrap()).toEqual({
      maxRequestBodyBytes: STRICT_MAX_REQUEST_BODY_BYTES,
      maxToolInputElements: STRICT_MAX_TOOL_INPUT_ELEMENTS,
    })
    expect(resolveMcpLimits("strict", { maxToolInputElements: "500" })._unsafeUnwrap()).toEqual({
      maxRequestBodyBytes: STRICT_MAX_REQUEST_BODY_BYTES,
      maxToolInputElements: 500,
    })
  })

  it("an invalid value is an error in both profiles, never 'no limit'", () => {
    for (const profile of ["standard", "strict"] as const) {
      for (const raw of ["0", "-1", "1.5", "1MB", "abc"]) {
        const r = resolveMcpLimits(profile, { maxRequestBodyBytes: raw })
        expect(r.isErr(), `${profile} MCP_MAX_REQUEST_BODY_BYTES=${raw}`).toBe(true)
      }
    }
  })
})

const echo = async (req: Request): Promise<Response> => new Response(await req.text())

const post = (body: BodyInit, headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/mcp", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit)

describe("withRequestBodyLimit", () => {
  it("passes a body under the cap through byte-for-byte", async () => {
    const body = JSON.stringify({ text: "привет ".repeat(50) })
    const res = await withRequestBodyLimit(echo, 4096)(post(body))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(body)
  })

  it("answers 413 on a declared Content-Length over the cap, without running the handler", async () => {
    let ran = false
    const inner = async (req: Request): Promise<Response> => {
      ran = true
      return echo(req)
    }
    const res = await withRequestBodyLimit(inner, 1024)(post("x".repeat(5000)))
    expect(res.status).toBe(413)
    expect(ran).toBe(false)
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32_600, message: "Request body exceeds 1024 bytes" },
      id: null,
    })
  })

  it("answers 413 on a streamed body with no Content-Length", async () => {
    const chunk = new TextEncoder().encode("y".repeat(600))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk)
        controller.enqueue(chunk)
        controller.close()
      },
    })
    const res = await withRequestBodyLimit(echo, 1000)(post(stream))
    expect(res.status).toBe(413)
  })

  it("is a passthrough with no cap configured", async () => {
    const res = await withRequestBodyLimit(echo)(post("z".repeat(5000)))
    expect(res.status).toBe(200)
    expect((await res.text()).length).toBe(5000)
  })
})

/** One tools/call through the real mcp-handler + MCP SDK, as the server wires it. */
const callProbeTool = async (
  maxToolInputElements: number | null,
  items: string[],
): Promise<{
  result: { isError?: boolean; content: { text: string }[] }
  schemaRuns: number
  handlerRuns: number
}> => {
  let schemaRuns = 0
  let handlerRuns = 0
  const inputSchema = z.object({
    items: z.array(z.string()).refine(() => {
      schemaRuns += 1
      return true
    }),
  })
  const handler = createMcpHandler(
    (server) => {
      server.registerTool(
        "probe",
        { description: "limit probe", inputSchema: inputSchema as never },
        (async () => {
          handlerRuns += 1
          return { content: [{ type: "text", text: "ran" }] }
        }) as never,
      )
    },
    {
      serverInfo: { name: "limits-test", version: "0.0.0" },
      capabilities: { tools: {} },
      ...mcpServerLimitOptions(maxToolInputElements === null ? {} : { maxToolInputElements }),
    },
    { basePath: "", maxDuration: 10 },
  )
  const res = await handler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "probe", arguments: { items } },
      }),
    }),
  )
  const text = await res.text()
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "))
  const message = JSON.parse(dataLine === undefined ? text : dataLine.slice("data: ".length)) as {
    result: { isError?: boolean; content: { text: string }[] }
  }
  return { result: message.result, schemaRuns, handlerRuns }
}

describe("maxToolInputElements through mcp-handler", () => {
  it("rejects an over-limit call before the schema or the handler runs", async () => {
    const out = await callProbeTool(
      100,
      Array.from({ length: 500 }, () => "x"),
    )
    expect(out.result.isError).toBe(true)
    expect(out.result.content[0]?.text).toBe(
      "MCP error -32602: Invalid arguments for tool probe: arguments contain more than the maximum of 100 elements",
    )
    expect(out.schemaRuns).toBe(0)
    expect(out.handlerRuns).toBe(0)
  })

  it("control: the same call runs when it is within the limit, and with no limit", async () => {
    const within = await callProbeTool(
      1000,
      Array.from({ length: 500 }, () => "x"),
    )
    expect(within.result.isError).toBeUndefined()
    expect(within.handlerRuns).toBe(1)
    const unlimited = await callProbeTool(
      null,
      Array.from({ length: 500 }, () => "x"),
    )
    expect(unlimited.handlerRuns).toBe(1)
  })
})
