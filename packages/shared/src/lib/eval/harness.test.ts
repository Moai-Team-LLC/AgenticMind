import { describe, expect, it } from "vitest"

import type { AskForEval, EvalCase, EvalObservation } from "./harness"

import { citationMetrics, evaluateCase, isRegression, runEvalSuite } from "./harness"

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
      query: "Ireland corporate tax?",
      assertions: { minCitations: 1, mustCiteMaterial: ["Ireland tax"], mustMention: ["12.5%"] },
    }
    const r = await evaluateCase(
      c,
      obs({
        answer: "It is 12.5% [1]",
        citations: [{ title: "Ireland tax guide", materialId: "m1" }],
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

  it("checks groundedness floor and abstention", async () => {
    const grounded: EvalCase = {
      id: "g1",
      failureMode: "faithfulness",
      query: "x",
      assertions: { minGroundedness: 0.8 },
    }
    expect(
      (
        await evaluateCase(
          grounded,
          obs({ answer: "a [1]", groundedness: 1, citations: [{ title: "t", materialId: "m" }] }),
        )
      ).passed,
    ).toBe(true)
    expect((await evaluateCase(grounded, obs({ answer: "a", groundedness: 0.5 }))).passed).toBe(
      false,
    )

    const oos: EvalCase = {
      id: "o1",
      failureMode: "faithfulness",
      query: "y",
      assertions: { expectAbstain: true, maxCitations: 0 },
    }
    expect((await evaluateCase(oos, obs({ abstained: true }))).passed).toBe(true)
    expect((await evaluateCase(oos, obs({ abstained: false, answer: "x [1]" }))).passed).toBe(false)
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

describe("citationMetrics", () => {
  it("computes precision + recall by case-insensitive substring", () => {
    // cited: 2 hits of 3 → precision 2/3; relevant: 2 of 2 matched → recall 1
    const m = citationMetrics(
      ["Ireland Tax Guide", "Estonia Tax", "Unrelated Memo"],
      ["ireland tax", "estonia tax"],
    )
    expect(m.precision).toBe(0.667)
    expect(m.recall).toBe(1)
  })

  it("recall < 1 when a relevant material is missed", () => {
    const m = citationMetrics(["Ireland Tax Guide"], ["ireland tax", "estonia tax"])
    expect(m.precision).toBe(1)
    expect(m.recall).toBe(0.5)
  })

  it("no citations → precision 1 (no false positives), recall 0", () => {
    expect(citationMetrics([], ["ireland tax"])).toEqual({ precision: 1, recall: 0 })
  })

  it("no gold → recall 1 (vacuous)", () => {
    expect(citationMetrics(["x"], [])).toEqual({ precision: 0, recall: 1 })
  })
})

describe("evaluateCase citation precision/recall gates", () => {
  const base: EvalCase = {
    id: "p1",
    failureMode: "citation_grounding",
    query: "q",
    assertions: {},
  }

  it("attaches precision/recall when relevantMaterials is declared", async () => {
    const r = await evaluateCase(
      { ...base, assertions: { relevantMaterials: ["ireland tax"] } },
      obs({ answer: "a [1]", citations: [{ title: "Ireland Tax Guide", materialId: "m1" }] }),
    )
    expect(r.precision).toBe(1)
    expect(r.recall).toBe(1)
    expect(r.passed).toBe(true)
  })

  it("fails when precision/recall fall below the gate", async () => {
    const r = await evaluateCase(
      {
        ...base,
        assertions: { relevantMaterials: ["estonia tax"], minCitationRecall: 1 },
      },
      obs({ answer: "a [1]", citations: [{ title: "Ireland Tax Guide", materialId: "m1" }] }),
    )
    expect(r.recall).toBe(0)
    expect(r.passed).toBe(false)
    expect(r.failures.some((f) => f.includes("citation recall"))).toBe(true)
  })

  it("omits metrics when no gold is declared", async () => {
    const r = await evaluateCase(base, obs({ answer: "a [1]", citations: [] }))
    expect(r.precision).toBeUndefined()
    expect(r.recall).toBeUndefined()
  })
})

describe("evaluateCase trust-signal assertions", () => {
  const base: EvalCase = {
    id: "t1",
    failureMode: "conflicting_sources",
    query: "q",
    assertions: {},
  }

  it("expectStatus passes when the status matches one of the allowed", async () => {
    const r = await evaluateCase(
      { ...base, assertions: { expectStatus: ["conflicted", "needs_review"] } },
      obs({ status: "conflicted" }),
    )
    expect(r.passed).toBe(true)
  })

  it("expectStatus fails on a mismatch", async () => {
    const r = await evaluateCase(
      { ...base, assertions: { expectStatus: ["conflicted"] } },
      obs({ status: "supported" }),
    )
    expect(r.passed).toBe(false)
    expect(r.failures.some((f) => f.includes("status"))).toBe(true)
  })

  it("expectContested checks presence of contested facts", async () => {
    expect(
      (
        await evaluateCase(
          { ...base, assertions: { expectContested: true } },
          obs({ contestedCount: 2 }),
        )
      ).passed,
    ).toBe(true)
    expect(
      (
        await evaluateCase(
          { ...base, assertions: { expectContested: true } },
          obs({ contestedCount: 0 }),
        )
      ).passed,
    ).toBe(false)
    expect(
      (
        await evaluateCase(
          { ...base, assertions: { expectContested: false } },
          obs({ contestedCount: 0 }),
        )
      ).passed,
    ).toBe(true)
  })

  it("expectStaleSourcesOnly checks the stale flag", async () => {
    expect(
      (
        await evaluateCase(
          { ...base, assertions: { expectStaleSourcesOnly: true } },
          obs({ staleSourcesOnly: true }),
        )
      ).passed,
    ).toBe(true)
    expect(
      (
        await evaluateCase(
          { ...base, assertions: { expectStaleSourcesOnly: true } },
          obs({ staleSourcesOnly: false }),
        )
      ).passed,
    ).toBe(false)
  })
})

describe("evaluateCase expectNoPii", () => {
  const base: EvalCase = { id: "pii1", failureMode: "pii_leak", query: "q", assertions: {} }

  it("fails when the answer leaks PII (email/phone)", async () => {
    const r = await evaluateCase(
      { ...base, assertions: { expectNoPii: true } },
      obs({
        answer: "Contact Dana at dana.lee@example.com or +1-202-555-0173.",
        citations: [{ title: "t", materialId: "m" }],
      }),
    )
    expect(r.passed).toBe(false)
    expect(r.failures.some((f) => f.includes("leaked PII"))).toBe(true)
  })

  it("passes when the answer carries no PII", async () => {
    const r = await evaluateCase(
      { ...base, assertions: { expectNoPii: true } },
      obs({
        answer: "The on-call engineer can be reached via the internal directory.",
        citations: [{ title: "t", materialId: "m" }],
      }),
    )
    expect(r.passed).toBe(true)
  })
})
