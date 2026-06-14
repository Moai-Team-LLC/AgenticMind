import { describe, expect, it } from "vitest"

import {
  listPredicates,
  listTypes,
  mapFreeFormPredicate,
  mapFreeFormType,
  normalisePredicate,
  ontologyV0,
  validateTriple,
} from "./ontology"

describe("ontology V0 schema", () => {
  it("loads the frozen vocabulary with cross-references intact", () => {
    expect(ontologyV0.version).toBe("V0")
    expect(listTypes()).toHaveLength(12)
    expect(listPredicates()).toHaveLength(21)
  })

  it("preserves declaration order", () => {
    expect(listTypes()[0]?.name).toBe("Person")
    expect(listPredicates()[0]?.name).toBe("works_at")
  })
})

describe("validateTriple", () => {
  it("accepts a well-formed entity triple", () => {
    expect(validateTriple("Person", "works_at", "Organization")).toBeNull()
  })

  it("accepts a string-kind predicate ignoring objectType", () => {
    expect(validateTriple("Person", "has_role", "")).toBeNull()
  })

  it("rejects an unknown subject_type", () => {
    expect(validateTriple("Robot", "works_at", "Organization")).toContain("unknown subject_type")
  })

  it("rejects a subject_type the predicate does not accept", () => {
    expect(validateTriple("Organization", "works_at", "Organization")).toContain(
      "does not accept subject_type",
    )
  })

  it("rejects a disallowed object_type", () => {
    expect(validateTriple("Person", "works_at", "Topic")).toContain("does not accept object_type")
  })
})

describe("normalisePredicate", () => {
  it("collapses whitespace, dashes and case to underscores", () => {
    expect(normalisePredicate("WORKS FOR")).toBe("works_for")
    expect(normalisePredicate("works-for")).toBe("works_for")
  })

  it("trims only surrounding punctuation, not interior (matches Go)", () => {
    expect(normalisePredicate("(founded)")).toBe("founded")
    expect(normalisePredicate("[works, for]")).toBe("works,_for")
  })
})

describe("mapFreeFormPredicate", () => {
  it("maps verb-phrase variants onto V0 predicates", () => {
    expect(mapFreeFormPredicate("works_for")).toBe("works_at")
    expect(mapFreeFormPredicate("employed by")).toBe("works_at")
  })

  it("is idempotent on already-typed predicates", () => {
    expect(mapFreeFormPredicate("created")).toBe("created")
  })

  it("returns undefined on a miss", () => {
    expect(mapFreeFormPredicate("teleports_to")).toBeUndefined()
  })
})

describe("mapFreeFormType", () => {
  it("maps free-form types onto V0 types", () => {
    expect(mapFreeFormType("person")).toBe("Person")
    expect(mapFreeFormType("technology")).toBe("Skill")
  })

  it("passes through canonical types case-insensitively", () => {
    expect(mapFreeFormType("company")).toBe("Organization")
    expect(mapFreeFormType("Person")).toBe("Person")
  })

  it("returns undefined for intentionally unmapped types", () => {
    expect(mapFreeFormType("framework")).toBeUndefined()
    expect(mapFreeFormType("concept")).toBeUndefined()
  })
})
