// oxlint-disable import/no-unassigned-import
import "./_test-env"
import { llmUsageSnapshot, resetLlmUsage } from "@agenticmind/shared/lib/observability/llm-usage"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as z from "zod"

import { completeKnowledge, completeKnowledgeJson } from "./llm"

// Only the network edge is stubbed: the real completeKnowledge / completeKnowledgeJson
// run, so this proves the accumulator is fed where the per-call usage span is.
vi.mock("ai", () => {
  return {
    generateText: async (opts: { output?: unknown }) =>
      opts.output === undefined
        ? { text: '{"ok":true}', usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 } }
        : { output: { ok: true }, usage: { inputTokens: 20, outputTokens: 2, totalTokens: 22 } },
    Output: { object: (o: unknown) => o },
  }
})

afterEach(() => {
  resetLlmUsage()
})

describe("llm.ts feeds the per-process usage accumulator", () => {
  it("records a plain completion under its model id", async () => {
    const res = await completeKnowledge({ system: "s", user: "u", model: "gpt-4o-mini" })
    expect(res.isOk()).toBe(true)
    expect(llmUsageSnapshot()).toEqual({
      "gpt-4o-mini": { calls: 1, inputTokens: 11, outputTokens: 4, callsWithoutUsage: 0 },
    })
  })

  it("records structured (OpenAI) and prompted-JSON (other family) completions", async () => {
    const schema = z.object({ ok: z.boolean() })
    expect((await completeKnowledgeJson({ system: "s", user: "u", schema })).isOk()).toBe(true)
    const other = await completeKnowledgeJson({
      system: "s",
      user: "u",
      schema,
      model: "google/gemini-2.5-flash",
    })
    expect(other.isOk()).toBe(true)
    expect(llmUsageSnapshot()).toEqual({
      "gpt-4o": { calls: 1, inputTokens: 20, outputTokens: 2, callsWithoutUsage: 0 },
      "google/gemini-2.5-flash": {
        calls: 1,
        inputTokens: 11,
        outputTokens: 4,
        callsWithoutUsage: 0,
      },
    })
  })
})
