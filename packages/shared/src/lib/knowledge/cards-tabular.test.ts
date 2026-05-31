import { describe, expect, it } from "vitest"

import { extractFromTables, parseTabularSchema } from "./cards-tabular"

describe("parseTabularSchema", () => {
  it("parses a valid schema with defaults", () => {
    const r = parseTabularSchema({
      subjectType: "Person",
      subjectColumn: "name",
      predicates: [{ column: "skill", predicate: "has_skill", objectType: "Skill" }],
      skipColumns: ["notes"],
    })
    expect(r.isOk()).toBe(true)
    if (r.isOk()) {
      expect(r.value.subjectType).toBe("Person")
      expect(r.value.minConfidence).toBe(0.95)
      expect(r.value.predicates).toHaveLength(1)
    }
  })

  it.each([
    { name: "missing subjectType", input: { subjectColumn: "name" } },
    { name: "unknown subjectType", input: { subjectType: "Robot", subjectColumn: "name" } },
    {
      name: "unknown predicate",
      input: {
        subjectType: "Person",
        subjectColumn: "name",
        predicates: [{ column: "x", predicate: "nope" }],
      },
    },
  ])("rejects $name", ({ input }) => {
    expect(parseTabularSchema(input).isErr()).toBe(true)
  })

  it("returns the no-schema error for null", () => {
    const r = parseTabularSchema(null)
    expect(r.isErr() && r.error).toContain("no tabular schema")
  })
})

describe("extractFromTables", () => {
  it("emits a qa summary + a fact card per mapped predicate", () => {
    const schema = parseTabularSchema({
      subjectType: "Person",
      subjectColumn: "name",
      predicates: [{ column: "skill", predicate: "has_skill", objectType: "Skill" }],
    })
    expect(schema.isOk()).toBe(true)
    if (!schema.isOk()) {
      return
    }

    const cards = extractFromTables(
      [{ name: "", headers: ["name", "skill"], rows: [["Alice", "Solidity"]] }],
      schema.value,
    )
    expect(cards).toHaveLength(2)
    const qa = cards.find((c) => c.kind === "qa")
    const fact = cards.find((c) => c.kind === "fact")
    expect(qa?.question).toBe("What is Alice?")
    expect(qa?.body).toBe("Alice — skill: Solidity.")
    expect(fact?.predicate).toBe("has_skill")
    expect(fact?.value).toBe("Solidity")
    expect(fact?.extractorVersion).toBe("tabular-v1")
  })

  it("skips rows with an empty subject value", () => {
    const schema = parseTabularSchema({
      subjectType: "Person",
      subjectColumn: "name",
      predicates: [],
    })
    if (!schema.isOk()) {
      throw new Error("schema parse failed")
    }
    const cards = extractFromTables(
      [{ name: "", headers: ["name"], rows: [[""], ["Bob"]] }],
      schema.value,
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]?.subjectValue).toBe("Bob")
  })
})
