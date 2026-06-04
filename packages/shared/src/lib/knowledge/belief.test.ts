import { describe, expect, it } from "vitest"

import type { BeliefClaim } from "./belief"

import {
  BELIEF_CONFIDENCE_HALF_LIFE_MS,
  beliefKey,
  decayedConfidence,
  detectConflicts,
  resolveConflict,
  summarizeContested,
} from "./belief"

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

describe("summarizeContested", () => {
  it("surfaces a disputed (subject,predicate) with one entry per competing object", () => {
    const out = summarizeContested([
      claim("a", "Ireland", "corporate-tax-rate", "12.5%"),
      claim("b", "Ireland", "corporate-tax-rate", "15%"),
      claim("c", "Estonia", "corporate-tax-rate", "20%"),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.subject).toBe("Ireland")
    expect(out[0]?.claims.map((c) => c.object).toSorted()).toEqual(["12.5%", "15%"])
  })

  it("returns nothing when all claims agree (whitespace-insensitive)", () => {
    expect(
      summarizeContested([
        claim("a", "Ireland", "rate", "12.5%"),
        claim("b", "Ireland", "rate", "12.5 %"),
      ]),
    ).toEqual([])
  })
})

describe("decayedConfidence", () => {
  const now = 1_000_000_000_000

  it("does not decay a freshly recorded belief", () => {
    expect(decayedConfidence(0.8, new Date(now), now)).toBeCloseTo(0.8, 10)
  })

  it("halves confidence after one half-life", () => {
    const old = new Date(now - BELIEF_CONFIDENCE_HALF_LIFE_MS)
    expect(decayedConfidence(0.8, old, now)).toBeCloseTo(0.4, 6)
  })

  it("quarters confidence after two half-lives", () => {
    const older = new Date(now - 2 * BELIEF_CONFIDENCE_HALF_LIFE_MS)
    expect(decayedConfidence(0.8, older, now)).toBeCloseTo(0.2, 6)
  })

  it("treats unknown age (null) as no decay, clamped to [0,1]", () => {
    expect(decayedConfidence(0.9, null, now)).toBe(0.9)
    expect(decayedConfidence(2, null, now)).toBe(1)
  })

  it("never decays below 0 and ignores future timestamps", () => {
    expect(decayedConfidence(0.5, new Date(now + 1_000_000), now)).toBeCloseTo(0.5, 10)
  })
})
