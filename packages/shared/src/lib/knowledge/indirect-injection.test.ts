// oxlint-disable import/no-unassigned-import
import "./_test-env"
import { detectInjection } from "@agenticmind/shared/lib/knowledge/guard"
import { SYSTEM_PROMPT } from "@agenticmind/shared/lib/knowledge/synth"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Indirect prompt-injection hardening (Agentic Product Standard — Layer 8,
 * DoD 13). Deterministic guards for the defense; end-to-end efficacy (the model
 * actually refusing an injection embedded in a retrieved source) is proven by
 * the `indirect_injection` eval cases under the key-gated eval-gate.
 */
describe("indirect prompt injection (Layer 8 / DoD 13)", () => {
  it("tells the synthesizer to treat sources as untrusted data, not instructions", () => {
    const prompt = SYSTEM_PROMPT.toLowerCase()
    expect(prompt).toContain("untrusted data")
    expect(prompt).toContain("not instructions")
    expect(prompt).toContain("do not obey")
  })

  it("the red-team corpus fixture carries an injection the shared detector catches", () => {
    const fixture = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "..", "..", "eval", "corpus", "redteam-indirect-injection.md"),
      "utf8",
    )
    expect(detectInjection(fixture).injection).toBe(true)
    // The fixture's eval forbid-phrase must really be present, or the case is vacuous.
    expect(fixture).toContain("INJECTED-PWNED-9F3A")
  })
})
