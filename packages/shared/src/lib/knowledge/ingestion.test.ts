import { describe, expect, it } from "vitest"

import { buildObjectKey, MAX_UPLOAD_BYTES, validateUpload } from "./ingestion"

const baseUpload = {
  filename: "doc.pdf",
  contentType: "application/pdf",
  sizeBytes: 100,
  body: new Uint8Array([1, 2, 3]),
}

describe("validateUpload", () => {
  it("accepts a well-formed upload", () => {
    expect(validateUpload(baseUpload)).toBeNull()
  })
  it("requires a filename", () => {
    expect(validateUpload({ ...baseUpload, filename: "" })).toContain("filename")
  })
  it("requires a positive size", () => {
    expect(validateUpload({ ...baseUpload, sizeBytes: 0 })).toContain("positive")
  })
  it("enforces the size cap", () => {
    expect(validateUpload({ ...baseUpload, sizeBytes: MAX_UPLOAD_BYTES + 1 })).toContain(
      "too large",
    )
  })
})

describe("buildObjectKey", () => {
  it("prefixes the material id and keeps the basename", () => {
    expect(buildObjectKey("abc-123", "report.pdf")).toBe("manual/abc-123/report.pdf")
  })
  it("strips directory components (incl. backslashes)", () => {
    expect(buildObjectKey("id", "C:\\Users\\a\\file.docx")).toBe("manual/id/file.docx")
    expect(buildObjectKey("id", "/var/tmp/x.csv")).toBe("manual/id/x.csv")
  })
  it("falls back to 'blob' for empty/dot names", () => {
    expect(buildObjectKey("id", "")).toBe("manual/id/blob")
    expect(buildObjectKey("id", ".")).toBe("manual/id/blob")
  })
})
