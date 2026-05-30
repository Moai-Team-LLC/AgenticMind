import { describe, expect, it } from "vitest"

import {
  extractDelimited,
  isLikelyHeader,
  isPurelyNumeric,
  renderTablesAsParagraphs,
} from "./extract-tabular"

describe("isPurelyNumeric", () => {
  it.each([
    ["12", true],
    ["-3.5", true],
    ["+7", true],
    ["1.2.3", false],
    ["abc", false],
    ["", false],
    ["12a", false],
  ])("%s → %s", (input, expected) => {
    expect(isPurelyNumeric(input)).toBe(expected)
  })
})

describe("isLikelyHeader", () => {
  it("accepts a row of labels", () => {
    expect(isLikelyHeader(["Name", "Age"])).toBe(true)
  })
  it("rejects numeric or empty cells", () => {
    expect(isLikelyHeader(["1", "2"])).toBe(false)
    expect(isLikelyHeader(["Name", ""])).toBe(false)
  })
})

describe("extractDelimited (CSV)", () => {
  it("detects a header row", () => {
    const t = extractDelimited("Name,Age\nAlice,30\nBob,25", ",")
    expect(t.headers).toEqual(["Name", "Age"])
    expect(t.rows).toEqual([
      ["Alice", "30"],
      ["Bob", "25"],
    ])
  })

  it("pads ragged rows to header width", () => {
    const t = extractDelimited("a,b,c\n1,2", ",")
    expect(t.headers).toEqual(["a", "b", "c"])
    expect(t.rows).toEqual([["1", "2", ""]])
  })

  it("synthesises headers when row 0 is numeric", () => {
    const t = extractDelimited("1,2,3\n4,5,6", ",")
    expect(t.headers).toEqual(["col_1", "col_2", "col_3"])
    expect(t.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ])
  })

  it("handles quoted fields with embedded delimiters", () => {
    const t = extractDelimited('name,note\nAlice,"hello, world"', ",")
    expect(t.rows).toEqual([["Alice", "hello, world"]])
  })

  it("parses TSV with a tab delimiter", () => {
    const t = extractDelimited("Name\tCity\nAlice\tLondon", "\t")
    expect(t.headers).toEqual(["Name", "City"])
    expect(t.rows).toEqual([["Alice", "London"]])
  })
})

describe("renderTablesAsParagraphs", () => {
  it("renders one paragraph per row, skipping empty cells", () => {
    const out = renderTablesAsParagraphs([
      {
        name: "",
        headers: ["name", "stage"],
        rows: [
          ["Alice", "seed"],
          ["Bob", ""],
        ],
      },
    ])
    expect(out).toBe("[row 1]\nname: Alice\nstage: seed\n\n[row 2]\nname: Bob")
  })

  it("prefixes the sheet name on multi-sheet input", () => {
    const out = renderTablesAsParagraphs([
      { name: "Members", headers: ["name"], rows: [["Alice"]] },
      { name: "Companies", headers: ["name"], rows: [["Acme"]] },
    ])
    expect(out).toContain('[Sheet "Members" — row 1]')
    expect(out).toContain('[Sheet "Companies" — row 1]')
  })
})
