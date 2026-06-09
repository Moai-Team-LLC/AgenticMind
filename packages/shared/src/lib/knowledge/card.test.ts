import { describe, expect, it } from "vitest"

import {
  CARD_KINDS,
  CARD_STATUSES,
  isCardKind,
  isCardStatus,
  NON_RETRIEVABLE_CARD_STATUSES,
} from "./card"

describe("card kinds", () => {
  it("freezes the V0 kind vocabulary", () => {
    expect(CARD_KINDS).toEqual(["fact", "qa", "definition", "metric", "procedure", "resolution"])
  })

  it("guards card kinds", () => {
    expect(isCardKind("resolution")).toBe(true)
    expect(isCardKind("opinion")).toBe(false)
  })
})

describe("card statuses", () => {
  it("freezes the lifecycle vocabulary", () => {
    expect(CARD_STATUSES).toEqual([
      "candidate",
      "reviewed",
      "approved",
      "rejected",
      "deprecated",
      "archived",
    ])
  })

  it("isCardStatus accepts known + rejects unknown", () => {
    expect(isCardStatus("approved")).toBe(true)
    expect(isCardStatus("candidate")).toBe(true)
    expect(isCardStatus("bogus")).toBe(false)
  })

  it("non-retrievable = rejected/deprecated/archived (approved/candidate/reviewed retrievable)", () => {
    expect([...NON_RETRIEVABLE_CARD_STATUSES]).toEqual(["rejected", "deprecated", "archived"])
    expect(NON_RETRIEVABLE_CARD_STATUSES.includes("approved")).toBe(false)
    expect(NON_RETRIEVABLE_CARD_STATUSES.includes("candidate")).toBe(false)
  })
})
