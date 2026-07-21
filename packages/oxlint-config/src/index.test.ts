import { describe, expect, it } from "vitest"

import { createOxlintConfig } from "./index"

/**
 * Gate-integrity guard. A safety-class lint rule (the `no-unsafe-*` family — the
 * net that stops an `any` propagating into typed code, the hole `strict` tsc
 * leaves open) must never be silently turned off to make CI green. This test is
 * the mechanical tripwire: it fails if any of them is not `error` at the base
 * level, or is relaxed by an override that targets anything other than
 * test/scripts globs. See the incident write-up: PR #99.
 *
 * To relax one of these for real, you must edit BOTH this allowlist and the
 * config — a deliberate, reviewable act, not a quiet one-line `off`.
 */
const SAFETY_RULES = [
  "typescript/no-unsafe-assignment",
  "typescript/no-unsafe-member-access",
  "typescript/no-unsafe-call",
  "typescript/no-unsafe-argument",
  "typescript/no-unsafe-return",
] as const

/** The ONLY globs allowed to relax a safety rule: non-shipped tooling where raw
 * DB rows / mocks are inherently `any`, and the cross-package spot the type-aware
 * engine is non-deterministic on. Never a production glob like `**​/*.ts`. */
const ALLOWED_RELAX_GLOBS = ["**/*.test.ts", "scripts/**/*.ts"]

const severityOf = (rule: unknown): string =>
  Array.isArray(rule) ? String(rule[0]) : String(rule)

describe("gate integrity: the no-unsafe-* safety net cannot be silently disabled", () => {
  const config = createOxlintConfig()

  it("keeps every safety rule at `error` in the base rules", () => {
    for (const rule of SAFETY_RULES) {
      const value = (config.rules as Record<string, unknown>)[rule]
      expect(value, `${rule} must be set in the base rules`).toBeDefined()
      expect(severityOf(value), `${rule} must be "error" at the base level`).toBe("error")
    }
  })

  it("relaxes a safety rule only in test/scripts overrides — never for production code", () => {
    const safety = new Set<string>(SAFETY_RULES)
    for (const override of config.overrides ?? []) {
      const rules = (override.rules ?? {}) as Record<string, unknown>
      const relaxed = Object.entries(rules).filter(
        ([name, value]) => safety.has(name) && severityOf(value) !== "error",
      )
      if (relaxed.length === 0) {
        continue
      }
      const files = override.files ?? []
      for (const glob of files) {
        expect(
          ALLOWED_RELAX_GLOBS.includes(glob),
          `override relaxing ${relaxed.map(([n]) => n).join(", ")} targets "${glob}" — safety rules may only be relaxed for ${ALLOWED_RELAX_GLOBS.join(" / ")}`,
        ).toBe(true)
      }
    }
  })
})
