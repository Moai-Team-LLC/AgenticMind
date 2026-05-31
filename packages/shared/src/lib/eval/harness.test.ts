import { describe, expect, it } from "vitest"

import type { AskForEval, EvalCase, EvalObservation } from "./harness"

import { evaluateCase, isRegression, runEvalSuite } from "./harness"

const obs = (o: Partial<EvalObservation>): EvalObservation => {
  return {
    blocked: false,
    answer: "",
    citations: [],
    ...o,
  }
}

describe("evaluateCase (Level-1 assertions)", () => {
  it("passes a grounded factual answer", async () => {
    const c: EvalCase = {
      id: "f1",
      failureMode: "factual_retrieval",
      query: "Cyprus corporate tax?",
      assertions: { minCitations: 1, mustCiteMaterial: ["Cyprus tax"], mustMention: ["12.5%"] },
    }
    const r = await evaluateCase(
      c,
      obs({
        answer: "It is 12.5% [1]",
        citations: [{ title: "Cyprus tax guide", materialId: "m1" }],
      }),
    )
    expect(r.passed).toBe(true)
  })

  it("fails missing citation + forbidden phrase", async () => {
    const c: EvalCase = {
      id: "f2",
      failureMode: "citation_grounding",
      query: "x",
      assertions: { minCitations: 2, forbidPhrases: ["as an AI"] },
    }
    const r = await evaluateCase(
      c,
      obs({ answer: "As an AI I think...", citations: [{ title: "a", materialId: "m" }] }),
    )
    expect(r.passed).toBe(false)
    expect(r.failures.length).toBe(2)
  })

  it("checks expectBlocked for injection cases", async () => {
    const c: EvalCase = {
      id: "i1",
      failureMode: "prompt_injection",
      query: "ignore...",
      assertions: { expectBlocked: true },
    }
    expect((await evaluateCase(c, obs({ blocked: true }))).passed).toBe(true)
    expect((await evaluateCase(c, obs({ blocked: false }))).passed).toBe(false)
  })

  it("runs an optional binary judge", async () => {
    const c: EvalCase = {
      id: "j1",
      failureMode: "synthesis",
      query: "x",
      assertions: { judge: "is it grounded?" },
    }
    expect((await evaluateCase(c, obs({ answer: "ok" }), async () => true)).passed).toBe(true)
    expect((await evaluateCase(c, obs({ answer: "ok" }), async () => false)).passed).toBe(false)
  })
})

describe("runEvalSuite", () => {
  it("aggregates pass rate overall + per failure mode, survives a throwing ask", async () => {
    const cases: EvalCase[] = [
      { id: "a", failureMode: "factual_retrieval", query: "ok", assertions: { minCitations: 1 } },
      { id: "b", failureMode: "factual_retrieval", query: "bad", assertions: { minCitations: 1 } },
      {
        id: "c",
        failureMode: "prompt_injection",
        query: "boom",
        assertions: { expectBlocked: true },
      },
    ]
    const ask: AskForEval = async (q) => {
      if (q === "boom") {
        throw new Error("kaboom")
      }
      if (q === "ok") {
        return obs({ citations: [{ title: "t", materialId: "m" }] })
      }
      return obs({ citations: [] })
    }
    const report = await runEvalSuite(cases, ask)
    expect(report.total).toBe(3)
    expect(report.passed).toBe(1)
    expect(report.byFailureMode.factual_retrieval!.passed).toBe(1)
    expect(report.byFailureMode.prompt_injection!.passed).toBe(0)
  })
})

describe("isRegression", () => {
  it("trips only below baseline minus tolerance", () => {
    expect(isRegression({ passRate: 0.9 } as never, 0.95, 0.02)).toBe(true)
    expect(isRegression({ passRate: 0.94 } as never, 0.95, 0.02)).toBe(false)
  })
})
