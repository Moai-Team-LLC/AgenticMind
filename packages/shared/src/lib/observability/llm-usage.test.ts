import { afterEach, describe, expect, it } from "vitest"

import {
  addLlmUsage,
  formatLlmUsageReport,
  llmUsageSnapshot,
  OTHER_MODELS,
  resetLlmUsage,
} from "./llm-usage"

afterEach(() => {
  resetLlmUsage()
})

describe("llm usage accumulator", () => {
  it("totals input and output tokens per model id", () => {
    addLlmUsage("gpt-4o", { inputTokens: 100, outputTokens: 20 })
    addLlmUsage("gpt-4o", { inputTokens: 50, outputTokens: 5 })
    addLlmUsage("gpt-4o-mini", { inputTokens: 7, outputTokens: 1 })
    expect(llmUsageSnapshot()).toEqual({
      "gpt-4o": { calls: 2, inputTokens: 150, outputTokens: 25, callsWithoutUsage: 0 },
      "gpt-4o-mini": { calls: 1, inputTokens: 7, outputTokens: 1, callsWithoutUsage: 0 },
    })
  })

  it("counts a call whose usage is missing or not a count, instead of dropping it", () => {
    addLlmUsage("m", {})
    addLlmUsage("m", { inputTokens: Number.NaN, outputTokens: -1 })
    addLlmUsage("m", { inputTokens: 3 })
    expect(llmUsageSnapshot()).toEqual({
      m: { calls: 3, inputTokens: 3, outputTokens: 0, callsWithoutUsage: 3 },
    })
  })

  it("returns a copy — a caller cannot change the totals", () => {
    addLlmUsage("m", { inputTokens: 1, outputTokens: 1 })
    const snap = llmUsageSnapshot()
    snap.m!.inputTokens = 999
    expect(llmUsageSnapshot().m!.inputTokens).toBe(1)
  })

  it("bounds the number of tracked model ids", () => {
    for (let i = 0; i < 100; i += 1) {
      addLlmUsage(`model-${i}`, { inputTokens: 1, outputTokens: 1 })
    }
    const snap = llmUsageSnapshot()
    expect(Object.keys(snap).length).toBeLessThanOrEqual(33)
    const calls = Object.values(snap).reduce((s, u) => s + u.calls, 0)
    expect(calls).toBe(100)
    expect(snap[OTHER_MODELS]!.calls).toBeGreaterThan(0)
  })
})

describe("formatLlmUsageReport", () => {
  it("prints one line per model and a total line with a marked estimate", () => {
    const lines = formatLlmUsageReport({
      "gpt-4o": { calls: 2, inputTokens: 1_000_000, outputTokens: 100_000, callsWithoutUsage: 0 },
      "gpt-4o-mini": { calls: 3, inputTokens: 2_000_000, outputTokens: 0, callsWithoutUsage: 0 },
    })
    expect(lines).toEqual([
      "  gpt-4o: 2 calls · 1,000,000 in / 100,000 out tokens · ≈ $3.50",
      "  gpt-4o-mini: 3 calls · 2,000,000 in / 0 out tokens · ≈ $0.30",
      "Usage: 3,100,000 tokens (3,000,000 in / 100,000 out) over 5 calls · ≈ $3.80 estimated at list prices, not a bill",
    ])
  })

  it("never prices a model it has no price for, and says the estimate is partial", () => {
    const lines = formatLlmUsageReport({
      "gpt-4o-mini": { calls: 1, inputTokens: 1_000_000, outputTokens: 0, callsWithoutUsage: 0 },
      "some/other": { calls: 1, inputTokens: 10, outputTokens: 2, callsWithoutUsage: 1 },
    })
    expect(lines).toEqual([
      "  gpt-4o-mini: 1 call · 1,000,000 in / 0 out tokens · ≈ $0.15",
      "  some/other: 1 call · 10 in / 2 out tokens · no list price · 1 call reported no usage",
      "Usage: 1,000,012 tokens (1,000,010 in / 2 out) over 2 calls · ≈ $0.15 estimated for gpt-4o-mini only (no list price: some/other), not a bill · 1 call reported no usage",
    ])
  })

  it("reports an empty run as zero, not as nothing", () => {
    expect(formatLlmUsageReport({})).toEqual([
      "Usage: 0 tokens (0 in / 0 out) over 0 calls · no model call returned",
    ])
  })
})
