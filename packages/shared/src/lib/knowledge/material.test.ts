import { describe, expect, it } from "vitest"

import { isMaterialSource, isMaterialStatus, MATERIAL_SOURCES, MATERIAL_STATUSES } from "./material"

describe("material enums", () => {
  it("freezes the source and status vocabularies", () => {
    expect(MATERIAL_SOURCES).toEqual(["manual", "http_url", "google_drive", "notion", "telegram"])
    expect(MATERIAL_STATUSES).toEqual(["ingesting", "chunking", "embedding", "embedded", "failed"])
  })

  it("guards sources", () => {
    expect(isMaterialSource("notion")).toBe(true)
    expect(isMaterialSource("email")).toBe(false)
  })

  it("guards statuses", () => {
    expect(isMaterialStatus("embedded")).toBe(true)
    expect(isMaterialStatus("done")).toBe(false)
  })
})
