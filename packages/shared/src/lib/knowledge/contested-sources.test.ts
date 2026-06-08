import { describe, expect, it } from "vitest"

import type { ContestedResponse, ContestedSourceInput } from "./contested-sources"

import { buildContestedUser, toContestedFacts } from "./contested-sources"

const src = (
  number: number,
  title: string,
  body: string,
  iso: string | null,
): ContestedSourceInput => {
  return { number, title, body, updatedAt: iso === null ? null : new Date(iso) }
}

const sources: ContestedSourceInput[] = [
  src(1, "2024 filing", "The corporate tax rate is 12.5%.", "2024-01-10"),
  src(2, "2026 update", "The corporate tax rate is 15%.", "2026-03-01"),
  src(3, "Geography", "The capital is Dublin.", null),
]

describe("toContestedFacts", () => {
  it("resolves source numbers to title + date for each side", () => {
    const resp: ContestedResponse = {
      contested: [
        {
          subject: "corporate tax rate",
          a: { source: 1, statement: "12.5%" },
          b: { source: 2, statement: "15%" },
        },
      ],
    }
    const out = toContestedFacts(resp, sources)
    expect(out).toEqual([
      {
        subject: "corporate tax rate",
        claims: [
          { statement: "12.5%", source: "2024 filing", date: "2024-01-10" },
          { statement: "15%", source: "2026 update", date: "2026-03-01" },
        ],
      },
    ])
  })

  it("carries a null date when the source has no updatedAt", () => {
    const resp: ContestedResponse = {
      contested: [
        {
          subject: "capital",
          a: { source: 3, statement: "Dublin" },
          b: { source: 1, statement: "Cork" },
        },
      ],
    }
    expect(toContestedFacts(resp, sources)[0]?.claims[0]).toEqual({
      statement: "Dublin",
      source: "Geography",
      date: null,
    })
  })

  it("carries each side's lifecycle when the source has one", () => {
    const withLifecycle: ContestedSourceInput[] = [
      {
        number: 1,
        title: "Old policy",
        body: "rate 12.5%",
        updatedAt: null,
        lifecycle: "superseded",
      },
      {
        number: 2,
        title: "Current policy",
        body: "rate 15%",
        updatedAt: null,
        lifecycle: "active",
      },
    ]
    const resp: ContestedResponse = {
      contested: [
        {
          subject: "rate",
          a: { source: 1, statement: "12.5%" },
          b: { source: 2, statement: "15%" },
        },
      ],
    }
    const out = toContestedFacts(resp, withLifecycle)
    expect(out[0]?.claims[0]?.lifecycle).toBe("superseded")
    expect(out[0]?.claims[1]?.lifecycle).toBe("active")
  })

  it("drops entries citing the same source on both sides", () => {
    const resp: ContestedResponse = {
      contested: [
        { subject: "x", a: { source: 1, statement: "a" }, b: { source: 1, statement: "b" } },
      ],
    }
    expect(toContestedFacts(resp, sources)).toEqual([])
  })

  it("drops entries referencing an unknown source number", () => {
    const resp: ContestedResponse = {
      contested: [
        { subject: "x", a: { source: 1, statement: "a" }, b: { source: 99, statement: "b" } },
      ],
    }
    expect(toContestedFacts(resp, sources)).toEqual([])
  })

  it("caps the list at 10", () => {
    const resp: ContestedResponse = {
      contested: Array.from({ length: 15 }, () => {
        return {
          subject: "rate",
          a: { source: 1, statement: "12.5%" },
          b: { source: 2, statement: "15%" },
        }
      }),
    }
    expect(toContestedFacts(resp, sources)).toHaveLength(10)
  })
})

describe("buildContestedUser", () => {
  it("numbers sources and annotates known dates", () => {
    const user = buildContestedUser(sources)
    expect(user).toContain("[1] 2024 filing (updated 2024-01-10)")
    expect(user).toContain("The corporate tax rate is 12.5%.")
    expect(user).toContain("[3] Geography\n")
    expect(user).not.toContain("[3] Geography (updated")
  })
})
