import { describe, expect, it } from "vitest"

import { pgUuidArrayLiteral } from "./answer-cache"

// Regression guard for the cache-store bug: the source_material_ids (uuid[]) bind
// must be a Postgres brace literal, NOT a drizzle-interpolated JS array (which
// renders as `($n)` → "malformed array literal" → every cache write failed).
describe("pgUuidArrayLiteral", () => {
  const a = "f18c707e-5dc8-499e-b4d6-ee02cd838e1c"
  const b = "a1b2c3d4-0000-1111-2222-333344445555"

  it("formats an empty list as {}", () => {
    expect(pgUuidArrayLiteral([])).toBe("{}")
  })

  it("formats a single id", () => {
    expect(pgUuidArrayLiteral([a])).toBe(`{${a}}`)
  })

  it("comma-joins multiple ids without spaces or quotes", () => {
    expect(pgUuidArrayLiteral([a, b])).toBe(`{${a},${b}}`)
  })

  it("never renders a parenthesised list (the bug)", () => {
    const out = pgUuidArrayLiteral([a, b])
    expect(out.startsWith("{")).toBe(true)
    expect(out.endsWith("}")).toBe(true)
    expect(out.includes("(")).toBe(false)
  })
})
