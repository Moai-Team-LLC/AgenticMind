import { describe, expect, it } from "vitest"

import { checkJudgeGeneratorDecorrelation, providerFamily, resolveJudgeModel } from "./judge-model"

describe("providerFamily", () => {
  it("maps ids (bare or provider/model) to a coarse family", () => {
    expect(providerFamily("gpt-4o")).toBe("openai")
    expect(providerFamily("openai/gpt-4o-mini")).toBe("openai")
    expect(providerFamily("o3-mini")).toBe("openai")
    expect(providerFamily("claude-3-5-sonnet-20241022")).toBe("anthropic")
    expect(providerFamily("google/gemini-1.5-pro")).toBe("google")
    expect(providerFamily("meta-llama/llama-3.1-70b")).toBe("open-weights")
  })
})

describe("checkJudgeGeneratorDecorrelation (§1a)", () => {
  it("flags a same-family judge and passes a different family", () => {
    expect(checkJudgeGeneratorDecorrelation("gpt-4o", "gpt-4o-mini").decorrelated).toBe(false)
    expect(checkJudgeGeneratorDecorrelation("gpt-4o", "claude-3-5-sonnet-20241022")).toEqual({
      decorrelated: true,
    })
  })
})

describe("resolveJudgeModel", () => {
  it("uses a configured judge model, else falls back to the generator model", () => {
    expect(resolveJudgeModel("gpt-4o", "google/gemini-1.5-pro")).toBe("google/gemini-1.5-pro")
    expect(resolveJudgeModel("gpt-4o", undefined)).toBe("gpt-4o")
    expect(resolveJudgeModel("gpt-4o", "")).toBe("gpt-4o")
  })
})
