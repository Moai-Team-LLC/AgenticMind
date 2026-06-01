import { describe, expect, it } from "vitest"

import type { BeliefClaim } from "./belief"

import { beliefKey, detectConflicts, resolveConflict } from "./belief"

const claim = (
  actor: string | null,
  subject: string,
  predicate: string,
  object: string,
  confidence = 0.7,
): BeliefClaim => {
  return {
    actorUuid: actor,
    subject,
    predicate,
    object,
    confidence,
  }
}

describe("belief identity", () => {
  it("is case/whitespace-insensitive on subject+predicate", () => {
    expect(beliefKey("Ireland", "corporate-tax-rate")).toBe(
      beliefKey("  ireland ", "Corporate-Tax-Rate"),
    )
    expect(beliefKey("Ireland", "rate")).not.toBe(beliefKey("Estonia", "rate"))
  })
})

describe("detectConflicts", () => {
  it("flags only (subject,predicate) groups with ≥2 distinct objects", () => {
    const conflicts = detectConflicts([
      claim("a", "Ireland", "tax", "12.5%"),
      claim("b", "Ireland", "tax", "10%"),
      claim("a", "Estonia", "tax", "20%"), // No conflict — single object
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.subject).toBe("Ireland")
    expect(conflicts[0]!.variants).toHaveLength(2)
  })

  it("treats same object from many actors as agreement, not conflict", () => {
    const conflicts = detectConflicts([
      claim("a", "Ireland", "tax", "12.5%"),
      claim("b", "Ireland", "tax", "12.5 %"), // Same after normalise
    ])
    expect(conflicts).toHaveLength(0)
  })
})

describe("resolveConflict", () => {
  it("prefers the object more actors corroborate", () => {
    const winner = resolveConflict([
      claim("a", "Ireland", "tax", "12.5%", 0.6),
      claim("b", "Ireland", "tax", "12.5%", 0.6),
      claim("c", "Ireland", "tax", "10%", 0.95), // Higher single confidence but lone
    ])
    expect(winner?.object).toBe("12.5%")
    expect(winner?.corroborators).toBe(2)
    expect(winner!.confidence).toBeGreaterThan(0.5)
  })

  it("falls back to confidence when corroboration ties", () => {
    const winner = resolveConflict([
      claim("a", "X", "p", "yes", 0.9),
      claim("b", "X", "p", "no", 0.4),
    ])
    expect(winner?.object).toBe("yes")
  })

  it("returns null on no claims", () => {
    expect(resolveConflict([])).toBeNull()
  })
})
