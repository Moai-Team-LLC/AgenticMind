import type { CardInput } from "@agenticmind/shared/database/query/knowledge/cards"

import { err, ok } from "neverthrow"
import { describe, expect, it } from "vitest"

import {
  admitCards,
  applyAcceptance,
  buildAcceptanceUser,
  MISSING_VERDICT_REASON,
} from "./acceptance-evaluator"

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

describe("acceptance gate in the strict profile (A7)", () => {
  it("applyAcceptance(card, []) fails closed: the card stays a candidate, with the reason", () => {
    const out = applyAcceptance([cards[0]!], [], { failClosed: true })
    expect(out).toEqual([
      { ...cards[0]!, status: "candidate", confidenceReason: MISSING_VERDICT_REASON },
    ])
  })

  it("control: the default still fails open (standard, unchanged)", () => {
    expect(applyAcceptance([cards[0]!], [])).toEqual([{ ...cards[0]!, status: "approved" }])
  })

  it("explicit verdicts are applied the same way in both modes", () => {
    const verdicts = [
      { index: 0, decision: "accept" as const, reason: "ok" },
      { index: 1, decision: "reject" as const, reason: "greeting" },
    ]
    const closed = applyAcceptance(cards.slice(0, 2), verdicts, { failClosed: true })
    expect(closed).toEqual(applyAcceptance(cards.slice(0, 2), verdicts))
  })

  it("an unavailable evaluator produces no approved cards when fail-closed", () => {
    const failed = err({ type: "llm_error", message: "upstream 503" })
    const out = admitCards(cards, failed, { failClosed: true })
    expect(out.length).toBe(cards.length)
    expect(out.filter((c) => c.status !== "candidate")).toEqual([])
    expect(out[0]?.confidenceReason).toBe("acceptance evaluator failed (llm_error): upstream 503")
  })

  it("control: standard keeps unjudged cards as before (born approved at the DB)", () => {
    const out = admitCards(cards, err({ type: "llm_error", message: "x" }))
    expect(out).toEqual(cards)
  })

  it("a judged batch passes through unchanged in both modes", () => {
    const judged = applyAcceptance(cards, [{ index: 0, decision: "accept", reason: "ok" }])
    expect(admitCards(cards, ok(judged), { failClosed: true })).toEqual(judged)
  })
})
