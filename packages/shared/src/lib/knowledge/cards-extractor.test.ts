import { describe, expect, it } from "vitest"

import { buildExtractionPrompt, validateExtraction, validateRawCard } from "./cards-extractor"

describe("buildExtractionPrompt", () => {
  it("renders the ontology vocabulary into the prompt", () => {
    const prompt = buildExtractionPrompt()
    expect(prompt).toContain("Allowed entity types")
    expect(prompt).toContain("- Member:")
    expect(prompt).toContain("- works_at:")
  })
})

describe("validateRawCard", () => {
  it("accepts a well-formed fact card", () => {
    const card = validateRawCard({
      kind: "fact",
      subject_type: "Member",
      subject_value: "Alice",
      predicate: "works_at",
      value: "Acme",
      body: "Alice works at Acme.",
      confidence: 0.9,
    })
    expect(card).not.toBeNull()
    expect(card?.kind).toBe("fact")
    expect(card?.predicate).toBe("works_at")
    expect(card?.value).toBe("Acme")
    expect(card?.extractorVersion).toBe("v1")
  })

  it("accepts a qa card with a question", () => {
    const card = validateRawCard({
      kind: "qa",
      subject_type: "Hub",
      subject_value: "Onboarding",
      body: "Follow the welcome flow.",
      question: "How do I onboard?",
      confidence: 0.8,
    })
    expect(card?.question).toBe("How do I onboard?")
  })

  it.each([
    { name: "unknown kind", patch: { kind: "opinion" } },
    { name: "unknown subject_type", patch: { subject_type: "Robot" } },
    { name: "empty subject_value", patch: { subject_value: "  " } },
    { name: "empty body", patch: { body: "" } },
    { name: "low confidence", patch: { confidence: 0.3 } },
    { name: "fact without predicate", patch: { predicate: "" } },
    { name: "fact with subject the predicate rejects", patch: { predicate: "offers_deal" } },
  ])("drops a card with $name", ({ patch }) => {
    const base = {
      kind: "fact",
      subject_type: "Member",
      subject_value: "Alice",
      predicate: "works_at",
      value: "Acme",
      body: "Alice works at Acme.",
      confidence: 0.9,
    }
    expect(validateRawCard({ ...base, ...patch })).toBeNull()
  })

  it("clamps confidence above 1", () => {
    const card = validateRawCard({
      kind: "definition",
      subject_type: "Skill",
      subject_value: "Solidity",
      body: "A smart-contract language.",
      confidence: 1.4,
    })
    expect(card?.confidence).toBe(1)
  })
})

describe("validateExtraction", () => {
  it("keeps valid cards and drops invalid ones", () => {
    const cards = validateExtraction({
      cards: [
        {
          kind: "fact",
          subject_type: "Member",
          subject_value: "Alice",
          predicate: "works_at",
          value: "Acme",
          body: "x",
          confidence: 0.9,
        },
        {
          kind: "nonsense",
          subject_type: "Member",
          subject_value: "Bob",
          body: "y",
          confidence: 0.9,
        },
      ],
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]?.subjectValue).toBe("Alice")
  })
})
