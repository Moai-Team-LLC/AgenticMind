import { describe, expect, it } from "vitest"

import type { CompiledSkill } from "./types"

import { checkSkillStructure, citationCoverage, parseSkillMd, renderSkillMd } from "./skill-md"

const skill = (over: Partial<CompiledSkill> = {}): CompiledSkill => ({
  frontmatter: {
    name: "deploy-strands-safely",
    target: "deploy-strands-safely",
    version: "1.0.0",
    corpusSnapshotId: "snap-abc",
    extractorModel: "gpt-4o-2024-11-20",
    extractorVersion: "extract-v1",
  },
  triggers: ["Use when deploying Strands to a droplet."],
  directives: [{ text: "Run migrate deploy, never migrate dev, on prod.", citations: [1] }],
  negatives: [
    { text: "Do NOT run make build_dev on the server (drops the prod DB).", citations: [2] },
  ],
  citations: [
    { marker: 1, materialId: "mat-1", chunk: "c3", title: "Strands deploy runbook" },
    { marker: 2, materialId: "mat-2", title: "Strands incident #4" },
  ],
  ...over,
})

describe("checkSkillStructure (L1 gate, §4)", () => {
  it("passes a well-formed, fully-cited skill", () => {
    expect(checkSkillStructure(skill())).toEqual({ ok: true, errors: [] })
  })

  it("fails an uncited directive", () => {
    const r = checkSkillStructure(skill({ directives: [{ text: "Do the thing.", citations: [] }] }))
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("no citation")
  })

  it("fails a citation marker with no defined source", () => {
    const r = checkSkillStructure(skill({ directives: [{ text: "Do X.", citations: [9] }] }))
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes("[^9]"))).toBe(true)
  })

  it("fails when there is no negative example or no trigger", () => {
    expect(checkSkillStructure(skill({ negatives: [] })).ok).toBe(false)
    expect(checkSkillStructure(skill({ triggers: [] })).ok).toBe(false)
  })
})

describe("citationCoverage", () => {
  it("is 1.0 when every instruction is cited, below when not", () => {
    expect(citationCoverage(skill())).toBe(1)
    expect(
      citationCoverage(skill({ directives: [{ text: "Uncited.", citations: [] }] })),
    ).toBeLessThan(1)
  })
})

describe("renderSkillMd + parseSkillMd round-trip", () => {
  it("emits a machine-readable SKILL.md that parses back to the same structure", () => {
    const s = skill()
    const md = renderSkillMd(s)
    expect(md).toContain("# deploy-strands-safely")
    expect(md).toContain("[^1]: mat-1#c3 — Strands deploy runbook")

    const parsed = parseSkillMd(md)
    expect(parsed.name).toBe("deploy-strands-safely")
    expect(parsed.version).toBe("1.0.0")
    expect(parsed.triggers).toEqual(s.triggers)
    expect(parsed.directives[0]?.text).toBe(s.directives[0]?.text)
    expect(parsed.directives[0]?.citations).toEqual([1])
    expect(parsed.negatives[0]?.citations).toEqual([2])
    expect(parsed.citationMarkers).toEqual([1, 2])
  })
})
