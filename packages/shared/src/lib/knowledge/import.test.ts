import { describe, expect, it } from "vitest"

import { deriveFilename, deriveTitle } from "./import-url"

describe("deriveTitle", () => {
  it("takes the last meaningful path segment", () => {
    expect(deriveTitle("https://example.com/blog/q3-strategy")).toBe("q3-strategy")
  })
  it("ignores query/fragment", () => {
    expect(deriveTitle("https://example.com/post?utm=x#frag")).toBe("post")
  })
  it("falls back to the host when path is empty", () => {
    expect(deriveTitle("https://example.com/")).toBe("example.com")
  })
})

describe("deriveFilename", () => {
  it("reuses the URL basename", () => {
    expect(deriveFilename("https://example.com/docs/spec.pdf", "application/pdf")).toBe("spec.pdf")
  })
  it("keeps the host as basename when the path is empty", () => {
    expect(deriveFilename("https://example.com/", "text/html")).toBe("example.com")
  })

  it("falls back by content type for empty basenames", () => {
    expect(deriveFilename("https://", "text/html")).toBe("page.html")
    expect(deriveFilename("https://", "application/pdf")).toBe("page.pdf")
    expect(deriveFilename("https://", "application/octet-stream")).toBe("page.bin")
  })
})
