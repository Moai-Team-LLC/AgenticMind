import { describe, expect, it } from "vitest"

import { DEFAULT_PROFILE, isStrict, parseProfile, PROFILES } from "./profile"

describe("parseProfile", () => {
  it("defaults to standard when unset or blank", () => {
    expect(DEFAULT_PROFILE).toBe("standard")
    for (const raw of [undefined, null, "", "   "]) {
      expect(parseProfile(raw)._unsafeUnwrap()).toBe("standard")
    }
  })

  it("accepts both profiles", () => {
    expect(PROFILES).toEqual(["standard", "strict"])
    expect(parseProfile("standard")._unsafeUnwrap()).toBe("standard")
    expect(parseProfile("strict")._unsafeUnwrap()).toBe("strict")
    expect(parseProfile(" strict ")._unsafeUnwrap()).toBe("strict")
  })

  it("rejects an unknown value instead of falling back to standard", () => {
    for (const raw of ["Strict", "strcit", "true", "1"]) {
      const result = parseProfile(raw)
      expect(result.isErr(), `AGENTICMIND_PROFILE=${raw}`).toBe(true)
      expect(result._unsafeUnwrapErr().type).toBe("invalid_profile")
    }
  })

  it("isStrict is true only for strict", () => {
    expect(isStrict("strict")).toBe(true)
    expect(isStrict("standard")).toBe(false)
  })
})
