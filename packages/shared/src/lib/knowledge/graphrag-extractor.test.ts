import { describe, expect, it } from "vitest"

import { parseExtraction } from "./graphrag-extractor"

describe("parseExtraction", () => {
  it("normalises entities and maps free-form types to V0", () => {
    const g = parseExtraction({
      entities: [
        { name: "Alice", type: "person", aliases: ["A. Smith"] },
        { name: "Acme", type: "company" },
      ],
      relations: [],
    })
    expect(g.entities).toHaveLength(2)
    expect(g.entities.find((e) => e.canonicalName === "Alice")?.ontologyType).toBe("Member")
    expect(g.entities.find((e) => e.canonicalName === "Acme")?.ontologyType).toBe("Company")
  })

  it("resolves relations by canonical name or alias and maps predicates", () => {
    const g = parseExtraction({
      entities: [
        { name: "Alice", type: "person", aliases: ["A. Smith"] },
        { name: "Acme", type: "company" },
      ],
      relations: [
        { from: "Alice", to: "Acme", predicate: "works_for" },
        { from: "A. Smith", to: "Acme", predicate: "founded" },
      ],
    })
    expect(g.relations).toHaveLength(2)
    expect(g.relations[0]?.ontologyPredicate).toBe("works_at")
    expect(g.relations[1]?.ontologyPredicate).toBe("founded")
  })

  it("drops unresolved and self relations", () => {
    const g = parseExtraction({
      entities: [{ name: "Alice", type: "person" }],
      relations: [
        { from: "Ghost", to: "Alice", predicate: "x" },
        { from: "Alice", to: "Alice", predicate: "self" },
      ],
    })
    expect(g.relations).toHaveLength(0)
  })

  it("defaults a blank predicate to related_to", () => {
    const g = parseExtraction({
      entities: [
        { name: "A", type: "concept" },
        { name: "B", type: "concept" },
      ],
      relations: [{ from: "A", to: "B", predicate: "" }],
    })
    expect(g.relations[0]?.predicate).toBe("related_to")
  })
})
