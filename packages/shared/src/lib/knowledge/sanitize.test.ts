import { describe, expect, it } from "vitest"

import { sanitizeForText } from "./sanitize"

const ctl = (code: number) => String.fromCharCode(code)

describe("sanitizeForText", () => {
  it("strips NUL and stray control characters", () => {
    const input = `a${ctl(0)}b${ctl(1)}c${ctl(31)}d`
    expect(sanitizeForText(input)).toBe("abcd")
  })

  it("keeps tab, newline and carriage return", () => {
    expect(sanitizeForText("a\tb\nc\rd")).toBe("a\tb\nc\rd")
  })

  it("leaves clean text untouched", () => {
    expect(sanitizeForText("Hello, café! 🚀")).toBe("Hello, café! 🚀")
  })

  it("replaces a lone surrogate with the replacement char", () => {
    expect(sanitizeForText("a\ud800b")).toBe("a�b")
  })

  it("preserves valid surrogate pairs", () => {
    expect(sanitizeForText("emoji 🚀 ok")).toBe("emoji 🚀 ok")
  })
})
