import { describe, expect, it } from "vitest"

import { canExtract, classify, extract } from "./extract"

const bytes = (s: string) => new TextEncoder().encode(s)

describe("classify", () => {
  it.each([
    ["text/html", "html"],
    ["application/xhtml+xml", "html"],
    ["text/csv", "csv"],
    ["text/tab-separated-values", "tsv"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
    ["text/plain; charset=utf-8", "text"],
    ["text/markdown", "text"],
    ["application/json", "text"],
    ["application/pdf", "pdf"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
    ["image/png", "unknown"],
  ])("%s → %s", (mime, kind) => {
    expect(classify(mime)).toBe(kind)
  })

  it("canExtract reflects classification", () => {
    expect(canExtract("text/csv")).toBe(true)
    expect(canExtract("image/png")).toBe(false)
  })
})

describe("extract", () => {
  it("passes text/* through unchanged", async () => {
    const r = await extract("text/markdown", bytes("# Hi\nbody"))
    expect(r.isOk() && r.value.text).toBe("# Hi\nbody")
  })

  it("parses CSV into tables + row paragraphs", async () => {
    const r = await extract("text/csv", bytes("Name,Age\nAlice,30"))
    expect(r.isOk()).toBe(true)
    if (r.isOk()) {
      expect(r.value.tables).toHaveLength(1)
      expect(r.value.tables[0]?.headers).toEqual(["Name", "Age"])
      expect(r.value.text).toContain("Name: Alice")
    }
  })

  it("errors on empty body", async () => {
    const r = await extract("text/plain", new Uint8Array())
    expect(r.isErr() && r.error.code).toBe("empty")
  })

  it("errors on unsupported MIME", async () => {
    const r = await extract("image/png", bytes("x"))
    expect(r.isErr() && r.error.code).toBe("unsupported")
  })
})
