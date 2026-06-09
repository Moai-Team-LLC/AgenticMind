import type { CardInput } from "@agenticmind/shared/database/query/knowledge/cards"

import { describe, expect, it } from "vitest"

import { applyAcceptance, buildAcceptanceUser } from "./acceptance-evaluator"

const card = (subjectValue: string, body: string): CardInput => {
  return { kind: "fact", subjectType: "entity", subjectValue, body, confidence: 0.8 }
}

const cards: CardInput[] = [
  card("Acme", "Acme was founded in 2019."),
  card("Acme", "hey everyone 👋"),
  card("Acme", "Acme might pivot to fintech soon."),
  card("Acme", "Acme HQ is in Berlin."),
]

describe("applyAcceptance", () => {
  it("accept → approved, human_review/merge → candidate, reject → dropped", () => {
    const out = applyAcceptance(cards, [
      { index: 0, decision: "accept", reason: "atomic fact" },
      { index: 1, decision: "reject", reason: "greeting" },
      { index: 2, decision: "human_review", reason: "speculation" },
      { index: 3, decision: "merge", reason: "dup of HQ" },
    ])
    expect(out).toHaveLength(3) // index 1 dropped
    expect(out[0]).toMatchObject({ subjectValue: "Acme", status: "approved" })
    expect(out[1]).toMatchObject({ status: "candidate", confidenceReason: "speculation" })
    expect(out[2]?.status).toBe("candidate")
  })

  it("fails OPEN — a missing verdict keeps the card as approved", () => {
    const out = applyAcceptance([card("X", "X ships v2 in Q3.")], [])
    expect(out).toHaveLength(1)
    expect(out[0]?.status).toBe("approved")
  })

  it("first verdict per index wins", () => {
    const out = applyAcceptance(
      [card("X", "body")],
      [
        { index: 0, decision: "reject", reason: "a" },
        { index: 0, decision: "accept", reason: "b" },
      ],
    )
    expect(out).toHaveLength(0)
  })
})

describe("buildAcceptanceUser", () => {
  it("numbers candidates with kind + subject", () => {
    const user = buildAcceptanceUser([card("Acme", "Acme was founded in 2019.")])
    expect(user).toContain("Candidate [0] (fact, subject=Acme):")
    expect(user).toContain("Acme was founded in 2019.")
  })
})
