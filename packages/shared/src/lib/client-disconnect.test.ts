import { describe, expect, it } from "vitest"

import { isClientDisconnectError } from "./client-disconnect"

describe("isClientDisconnectError", () => {
  it("matches the closed-controller / disconnect class", () => {
    // The exact error a dropped MCP client triggers in mcp-handler's stream pump.
    expect(
      isClientDisconnectError(
        Object.assign(new Error("Invalid state: Controller is already closed"), {
          code: "ERR_INVALID_STATE",
        }),
      ),
    ).toBe(true)
    expect(isClientDisconnectError(new Error("Controller is already closed."))).toBe(true)
    expect(
      isClientDisconnectError({ name: "AbortError", message: "The operation was aborted" }),
    ).toBe(true)
    expect(isClientDisconnectError({ code: "ERR_STREAM_PREMATURE_CLOSE" })).toBe(true)
    expect(isClientDisconnectError({ code: "ECONNRESET" })).toBe(true)
    expect(isClientDisconnectError({ code: "EPIPE" })).toBe(true)
    expect(isClientDisconnectError(new Error("write EPIPE"))).toBe(true)
  })

  it("does NOT match genuine application faults (they must stay fatal)", () => {
    expect(isClientDisconnectError(new TypeError("Cannot read properties of undefined"))).toBe(
      false,
    )
    expect(isClientDisconnectError(new Error("kl_ask_global: synthesis failed"))).toBe(false)
    expect(isClientDisconnectError(new RangeError("Maximum call stack size exceeded"))).toBe(false)
    expect(isClientDisconnectError(null)).toBe(false)
    expect(isClientDisconnectError()).toBe(false)
    expect(isClientDisconnectError("a plain string")).toBe(false)
  })
})
