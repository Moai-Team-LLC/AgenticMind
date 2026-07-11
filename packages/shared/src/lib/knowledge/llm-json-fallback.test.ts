import { describe, expect, it } from "vitest"

import { parseJsonObjectLoose } from "./llm"

describe("parseJsonObjectLoose (non-OpenAI judge fallback)", () => {
  it("parses a bare JSON object", () => {
    expect(parseJsonObjectLoose('{"verdict":"supported","score":0.8}')).toEqual({
      verdict: "supported",
      score: 0.8,
    })
  })

  it("strips a ```json fenced block (as Gemini often wraps it)", () => {
    const raw = '```json\n{"ok":true}\n```'
    expect(parseJsonObjectLoose(raw)).toEqual({ ok: true })
  })

  it("strips a bare ``` fence", () => {
    expect(parseJsonObjectLoose('```\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it("recovers the object from surrounding prose", () => {
    const raw = 'Here is the verdict:\n{"verdict":"unsupported"}\nHope that helps!'
    expect(parseJsonObjectLoose(raw)).toEqual({ verdict: "unsupported" })
  })

  it("throws when there is no JSON object to recover", () => {
    expect(() => parseJsonObjectLoose("I cannot answer that.")).toThrow()
  })
})
