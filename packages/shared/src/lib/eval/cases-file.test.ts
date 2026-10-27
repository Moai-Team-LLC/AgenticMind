import { answerPolicySchema } from "@agenticmind/shared/lib/knowledge/answer-policy"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import type { EvalCase } from "./harness"

const ROOT = new URL("../../../../../", import.meta.url)
const cases = JSON.parse(readFileSync(new URL("eval/cases.json", ROOT), "utf8")) as EvalCase[]

// The engine's default posture is "surface, don't decide" (docs/evals.md, Abstention
// posture): with sources retrieved, an out-of-corpus answer is reported unsupported,
// not abstained; it refuses only under an answer policy. A case that expects a
// refusal without one measures behaviour the default deployment does not have.
describe("eval/cases.json", () => {
  it("is non-empty (control)", () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  it("expects a refusal only from cases that run under an answer policy", () => {
    const mismatched = cases
      .filter((c) => c.assertions.expectAbstain === true && c.answerPolicy === undefined)
      .map((c) => c.id)
    expect(mismatched, `expectAbstain without answerPolicy: ${mismatched.join(", ")}`).toEqual([])
  })

  it("measures both halves of the out-of-corpus posture", () => {
    const refusals = cases.filter(
      (c) => c.answerPolicy !== undefined && c.assertions.expectAbstain === true,
    )
    const surfaced = cases.filter(
      (c) =>
        c.failureMode === "faithfulness" &&
        c.answerPolicy === undefined &&
        (c.assertions.expectStatus ?? []).includes("unsupported"),
    )
    expect(refusals.map((c) => c.id).length, "policy refusal cases").toBeGreaterThan(0)
    expect(surfaced.map((c) => c.id).length, "default-posture unsupported cases").toBeGreaterThan(0)
  })

  it("every case-level answerPolicy is one the server would accept", () => {
    const invalid = cases
      .filter((c) => c.answerPolicy !== undefined)
      .filter((c) => !answerPolicySchema.safeParse(c.answerPolicy).success)
      .map((c) => c.id)
    expect(invalid, `invalid answerPolicy: ${invalid.join(", ")}`).toEqual([])
  })
})
