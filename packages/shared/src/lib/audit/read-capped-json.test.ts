import { describe, expect, it } from "vitest"

import { readCappedJson } from "./read-capped-json"

const postString = (body: string): Request =>
  new Request("http://localhost/hooks/audit", { method: "POST", body })

describe("readCappedJson", () => {
  it("parses a JSON body under the cap", async () => {
    const result = await readCappedJson(postString(JSON.stringify({ a: 1 })), 1024)
    expect(result).toEqual({ ok: true, value: { a: 1 } })
  })

  it("rejects when Content-Length exceeds the cap (fast path, no read)", async () => {
    const big = JSON.stringify({ x: "y".repeat(5000) })
    const result = await readCappedJson(postString(big), 1024)
    expect(result).toEqual({ ok: false, reason: "too_large" })
  })

  it("rejects oversized bodies without a truthful Content-Length (stream cap)", async () => {
    const payload = new TextEncoder().encode("z".repeat(4096))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload)
        controller.close()
      },
    })
    // A streamed request body carries no Content-Length, so only the byte counter can catch it.
    const init: RequestInit & { duplex: "half" } = { method: "POST", body: stream, duplex: "half" }
    const result = await readCappedJson(new Request("http://localhost/hooks/audit", init), 1024)
    expect(result).toEqual({ ok: false, reason: "too_large" })
  })

  it("returns invalid_json for a non-JSON body under the cap", async () => {
    const result = await readCappedJson(postString("not json at all"), 1024)
    expect(result).toEqual({ ok: false, reason: "invalid_json" })
  })

  it("returns invalid_json for an empty body", async () => {
    const result = await readCappedJson(postString(""), 1024)
    expect(result).toEqual({ ok: false, reason: "invalid_json" })
  })
})
