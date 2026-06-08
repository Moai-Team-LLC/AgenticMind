import type { HarvestedQuery } from "@agenticmind/shared/database/query/knowledge/ask-telemetry"

import { describe, expect, it } from "vitest"

import { signalCasesFromHarvest } from "./signal-eval-cases"

const q = (questionText: string, netStrength: number): HarvestedQuery => {
  return { questionText, netStrength }
}

describe("signalCasesFromHarvest", () => {
  it("turns a net-positive query into a grounded, cited, non-abstain case", () => {
    const out = signalCasesFromHarvest([q("What is the refund policy?", 1.8)])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      failureMode: "production_signal",
      query: "What is the refund policy?",
      assertions: { expectAbstain: false, minCitations: 1, minGroundedness: 0.5 },
    })
    expect(out[0]?.id.startsWith("signal-")).toBe(true)
  })

  it("excludes net-zero and net-negative queries", () => {
    expect(
      signalCasesFromHarvest([
        q("a flaky answer that failed downstream", 0),
        q("contested one", -0.7),
      ]),
    ).toEqual([])
  })

  it("drops queries shorter than the minimum", () => {
    expect(signalCasesFromHarvest([q("hi", 1)])).toEqual([])
  })

  it("dedupes by normalised text (case + whitespace insensitive)", () => {
    const out = signalCasesFromHarvest([
      q("What is   the Refund Policy?", 1),
      q("what is the refund policy?", 2),
    ])
    expect(out).toHaveLength(1)
  })

  it("gives the same query a stable id across runs", () => {
    const a = signalCasesFromHarvest([q("explain the onboarding flow", 1)])
    const b = signalCasesFromHarvest([q("explain the onboarding flow", 1)])
    expect(a[0]?.id).toBe(b[0]?.id)
  })

  it("honours minGroundedness + maxCases overrides", () => {
    const rows = Array.from({ length: 5 }, (_, i) => q(`distinct question number ${i}`, 1))
    const out = signalCasesFromHarvest(rows, { minGroundedness: 0.7, maxCases: 2 })
    expect(out).toHaveLength(2)
    expect(out[0]?.assertions.minGroundedness).toBe(0.7)
  })
})
