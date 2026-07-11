import { afterEach, describe, expect, it, vi } from "vitest"

import { warnIfJudgeCorrelated } from "./ask"

const spyWarn = (): ReturnType<typeof vi.spyOn> =>
  vi.spyOn(console, "warn").mockImplementation(() => {
    // suppress the expected warning from test output
  })

// "not configured" — the intended honest-degraded path (resolveJudgeModel falls back to
// the generator). Held as a typed const so the literal `undefined` reads as intent.
const NOT_CONFIGURED: string | undefined = undefined

describe("warnIfJudgeCorrelated (doctrine §1a fail-loud guard)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("warns when a distinct judge model is configured but still the generator's family", () => {
    const warn = spyWarn()
    // configured "gpt-4o-mini" resolves to the same openai family as the gpt-4o generator
    warnIfJudgeCorrelated({ faithfulnessTierB: true }, "gpt-4o", "gpt-4o-mini", "gpt-4o-mini")
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain("decorrelation OFF")
  })

  it("stays quiet on the intended honest-degraded path (no CHAT_JUDGE_MODEL set)", () => {
    const warn = spyWarn()
    warnIfJudgeCorrelated({ faithfulnessTierB: true }, "gpt-4o", "gpt-4o", NOT_CONFIGURED)
    expect(warn).not.toHaveBeenCalled()
  })

  it("stays quiet when a genuinely different family is configured", () => {
    const warn = spyWarn()
    warnIfJudgeCorrelated(
      { contestedSources: true },
      "gpt-4o",
      "google/gemini-1.5-pro",
      "google/gemini-1.5-pro",
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it("stays quiet when no judge will run (both flags off), even if mis-decorrelated", () => {
    const warn = spyWarn()
    warnIfJudgeCorrelated({}, "gpt-4o", "gpt-4o-mini", "gpt-4o-mini")
    expect(warn).not.toHaveBeenCalled()
  })
})
