import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Scripts launched with `tsx` run on Node, not Bun. A Bun-only API in one of them
 * (`import.meta.dir`, the `Bun` global) crashes it at startup — which is how the
 * eval-gate's seed and eval steps were broken without anyone noticing, since the
 * gate never ran. The launch commands are read from package.json and the
 * workflows, so a newly wired script is covered the moment it is added.
 */

const ROOT = new URL("../../../../", import.meta.url)
const read = (rel: string): string => readFileSync(new URL(rel, ROOT), "utf8")

const BUN_ONLY: { name: string; pattern: RegExp }[] = [
  { name: "import.meta.dir", pattern: /\bimport\.meta\.dir\b(?!name)/u },
  { name: "Bun global", pattern: /\bBun\.[a-zA-Z]/u },
]

/** Every `scripts/<file>.ts` that some command runs through `tsx`. */
const tsxScripts = (): { script: string; from: string }[] => {
  const sources: { from: string; text: string }[] = [
    {
      from: "package.json",
      text: Object.values(
        (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts,
      ).join("\n"),
    },
    ...readdirSync(new URL(".github/workflows/", ROOT)).map((f) => {
      return { from: `.github/workflows/${f}`, text: read(`.github/workflows/${f}`) }
    }),
  ]
  const found = new Map<string, string>()
  for (const { from, text } of sources) {
    for (const m of text.matchAll(/\btsx\s+(scripts\/[\w./-]+\.ts)\b/gu)) {
      found.set(m[1] ?? "", from)
    }
  }
  return [...found].map(([script, from]) => {
    return { script, from }
  })
}

describe("scripts run with tsx are Node-compatible", () => {
  it("no tsx-launched script uses a Bun-only API", () => {
    const scripts = tsxScripts()
    // Control: the launch commands were actually found (prints what was scanned).
    expect(scripts.length, `scripts: ${scripts.map((s) => s.script).join(", ")}`).toBeGreaterThan(0)
    const problems: string[] = []
    for (const { script, from } of scripts) {
      const text = read(script)
      for (const { name, pattern } of BUN_ONLY) {
        if (pattern.test(text)) {
          problems.push(`${script} (run with tsx by ${from}) uses ${name}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it("the eval-gate's own steps are among the scanned scripts", () => {
    const scripts = tsxScripts().map((s) => s.script)
    expect(scripts).toContain("scripts/eval.ts")
    expect(scripts).toContain("scripts/seed-eval-corpus.ts")
  })
})
