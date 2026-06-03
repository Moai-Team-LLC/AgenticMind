import { describe, expect, it } from "vitest"

import {
  buildJudgeUser,
  confidenceForScore,
  judgeAllowsPromotion,
  parseAnswerGroundedness,
  parseJudgeResponse,
  shouldAbstain,
  truncate,
} from "./feedback-judge"

describe("parseJudgeResponse", () => {
  it("parses a clean JSON verdict", () => {
    expect(parseJudgeResponse('{"verdict":"supported","rationale":"grounded in [1]"}')).toEqual({
      verdict: "supported",
      rationale: "grounded in [1]",
    })
  })
  it("tolerates ```json code fences", () => {
    const raw = '```json\n{"verdict":"unsupported","rationale":"no snippet covers it"}\n```'
    expect(parseJudgeResponse(raw)).toEqual({
      verdict: "unsupported",
      rationale: "no snippet covers it",
    })
  })
  it("falls back to unknown on invalid JSON", () => {
    expect(parseJudgeResponse("not json").verdict).toBe("unknown")
  })
  it("rejects an unrecognised verdict", () => {
    expect(parseJudgeResponse('{"verdict":"great"}').verdict).toBe("unknown")
  })
})

describe("judgeAllowsPromotion", () => {
  it("promotes only on supported", () => {
    expect(judgeAllowsPromotion("supported")).toBe(true)
    expect(judgeAllowsPromotion("partially_supported")).toBe(false)
    expect(judgeAllowsPromotion("unsupported")).toBe(false)
    expect(judgeAllowsPromotion("unknown")).toBe(false)
  })
})

describe("confidenceForScore", () => {
  it("tiers confidence by aggregate score", () => {
    expect(confidenceForScore(1.2)).toBe(0.95)
    expect(confidenceForScore(0.9)).toBe(0.85)
    expect(confidenceForScore(0.7)).toBe(0.7)
  })
})

describe("truncate", () => {
  it("keeps short strings and cuts long ones rune-safely", () => {
    expect(truncate("short", 200)).toBe("short")
    expect(truncate("abcdef", 3)).toBe("abc")
  })
})

describe("buildJudgeUser", () => {
  it("notes uncited answers", () => {
    expect(buildJudgeUser("q", "a", [])).toContain("(no snippets — answer was uncited)")
  })
  it("numbers the snippets", () => {
    const out = buildJudgeUser("q", "a", [{ title: "Doc", snippet: "text" }])
    expect(out).toContain("[1] Doc")
  })
})

describe("parseAnswerGroundedness", () => {
  it("parses verdict + unsupported claims (with code fences)", () => {
    const g = parseAnswerGroundedness(
      '```json\n{ "verdict": "partially_supported", "unsupported": ["claim X", " ", "claim Y"] }\n```',
    )
    expect(g.verdict).toBe("partially_supported")
    expect(g.unsupported).toEqual(["claim X", "claim Y"])
  })
  it("defaults to unknown + empty on bad JSON or bad verdict", () => {
    expect(parseAnswerGroundedness("not json")).toEqual({ verdict: "unknown", unsupported: [] })
    expect(parseAnswerGroundedness('{"verdict":"maybe"}')).toEqual({
      verdict: "unknown",
      unsupported: [],
    })
  })
})

describe("shouldAbstain", () => {
  it("abstains on unsupported / unknown, not on supported / partial", () => {
    expect(shouldAbstain({ verdict: "unsupported", unsupported: [] })).toBe(true)
    expect(shouldAbstain({ verdict: "unknown", unsupported: [] })).toBe(true)
    expect(shouldAbstain({ verdict: "supported", unsupported: [] })).toBe(false)
    expect(shouldAbstain({ verdict: "partially_supported", unsupported: ["x"] })).toBe(false)
  })
})
