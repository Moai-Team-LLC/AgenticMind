import { describe, expect, it } from "vitest"

import { isMaterialSource, isMaterialStatus, MATERIAL_SOURCES, MATERIAL_STATUSES } from "./material"

describe("material enums", () => {
  it("freezes the source and status vocabularies", () => {
    expect(MATERIAL_SOURCES).toEqual(["manual"])
    expect(MATERIAL_STATUSES).toEqual(["ingesting", "chunking", "embedding", "embedded", "failed"])
  })

  it("guards sources", () => {
    expect(isMaterialSource("manual")).toBe(true)
    // Dropped crawl-connector origins are no longer valid sources.
    expect(isMaterialSource("notion")).toBe(false)
  })

  it("guards statuses", () => {
    expect(isMaterialStatus("embedded")).toBe(true)
    expect(isMaterialStatus("done")).toBe(false)
  })
})
