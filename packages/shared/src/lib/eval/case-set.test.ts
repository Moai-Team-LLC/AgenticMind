import { describe, expect, it } from "vitest"

import { mergeGeneratedCases } from "./case-set"

type C = { id: string; failureMode: string; query?: string }

const gen: C[] = [
  { id: "fact-1", failureMode: "factual_retrieval", query: "new wording" },
  { id: "oos-1", failureMode: "out_of_scope" },
]

describe("mergeGeneratedCases", () => {
  it("keeps every hand-written case (a mode the generator does not emit) verbatim, in order", () => {
    const existing: C[] = [
      { id: "fact-1", failureMode: "factual_retrieval", query: "old wording" },
      { id: "oos-1", failureMode: "out_of_scope" },
      { id: "faith-1", failureMode: "faithfulness", query: "q1" },
      { id: "pii-1", failureMode: "pii_leak", query: "q2" },
    ]
    const res = mergeGeneratedCases(existing, gen)._unsafeUnwrap()
    expect(res.cases).toEqual([
      { id: "fact-1", failureMode: "factual_retrieval", query: "new wording" },
      { id: "oos-1", failureMode: "out_of_scope" },
      { id: "faith-1", failureMode: "faithfulness", query: "q1" },
      { id: "pii-1", failureMode: "pii_leak", query: "q2" },
    ])
    expect(res.kept).toEqual(["faith-1", "pii-1"])
  })

  it("refuses a regeneration that would lose an existing case", () => {
    const existing: C[] = [...gen, { id: "fact-2", failureMode: "factual_retrieval" }]
    const res = mergeGeneratedCases(existing, gen)
    expect(res.isErr()).toBe(true)
    expect(res._unsafeUnwrapErr()).toContain("fact-2")
  })

  it("refuses to drop a hand-written case in a mode the generator emits", () => {
    const existing: C[] = [...gen, { id: "fact-manual", failureMode: "factual_retrieval" }]
    expect(mergeGeneratedCases(existing, gen)._unsafeUnwrapErr()).toContain("fact-manual")
  })

  it("drops a case only when it is named explicitly", () => {
    const existing: C[] = [...gen, { id: "fact-2", failureMode: "factual_retrieval" }]
    const res = mergeGeneratedCases(existing, gen, ["fact-2"])._unsafeUnwrap()
    expect(res.cases.map((c) => c.id)).toEqual(["fact-1", "oos-1"])
    expect(res.dropped).toEqual(["fact-2"])
  })

  it("rejects an allow-drop id that would not be dropped (typo or stale)", () => {
    expect(mergeGeneratedCases(gen, gen, ["fact-9"]).isErr()).toBe(true)
  })

  it("rejects a kept case whose id collides with a generated one", () => {
    const existing: C[] = [...gen, { id: "fact-1", failureMode: "faithfulness" }]
    expect(mergeGeneratedCases(existing, gen).isErr()).toBe(true)
  })

  it("a first run with no existing file writes the generated cases", () => {
    expect(mergeGeneratedCases([], gen)._unsafeUnwrap().cases).toEqual(gen)
  })
})
