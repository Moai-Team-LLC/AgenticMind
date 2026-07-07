import { describe, expect, it } from "vitest"

import type { AssuranceNotification } from "./channel"

import { makeTelegramNotifier, renderTelegramText } from "./telegram"

const notification: AssuranceNotification = {
  kind: "drift",
  severity: "critical",
  title: "Assurance drift on agenticmind-engine",
  body: "1 control regressed (AAL-SEC-01 green→red)",
  context: { target: "agenticmind-engine", regressions: 1 },
}

describe("renderTelegramText", () => {
  it("renders a payload-free plain-text message with a severity icon", () => {
    const text = renderTelegramText(notification)
    expect(text).toContain("🔴")
    expect(text).toContain("Assurance drift on agenticmind-engine")
    expect(text).toContain("AAL-SEC-01 green→red")
    expect(text).toContain("target: agenticmind-engine")
  })
})

describe("makeTelegramNotifier", () => {
  it("POSTs the rendered message to the Telegram sendMessage API", async () => {
    const calls: { url: string; body: { chat_id: string; text: string } }[] = []
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : ""
      calls.push({ url, body: JSON.parse(body) })
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch

    const notify = makeTelegramNotifier({ botToken: "TKN", chatId: "42", fetchImpl: fakeFetch })
    await notify(notification)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("https://api.telegram.org/botTKN/sendMessage")
    expect(calls[0]?.body.chat_id).toBe("42")
    expect(calls[0]?.body.text).toContain("AAL-SEC-01 green→red")
  })

  it("throws when Telegram returns a non-OK status", async () => {
    const fakeFetch = (async () => new Response("bad", { status: 400 })) as unknown as typeof fetch
    const notify = makeTelegramNotifier({ botToken: "T", chatId: "1", fetchImpl: fakeFetch })
    await expect(notify(notification)).rejects.toThrow(/telegram sendMessage failed/)
  })
})
