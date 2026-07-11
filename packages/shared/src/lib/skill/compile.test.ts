import { describe, expect, it } from "vitest"

import type { ExtractedSkill, SkillExtractor } from "./compile"

import { compileSkill, providerFamily } from "./compile"

const goodExtract: ExtractedSkill = {
  triggers: ["Use when deploying Strands."],
  directives: [{ text: "Run migrate deploy on prod, never migrate dev.", citations: [1] }],
  negatives: [{ text: "Do NOT run make build_dev on the server.", citations: [2] }],
  citations: [
    { marker: 1, materialId: "m1", chunk: "c3", title: "runbook" },
    { marker: 2, materialId: "m2", title: "incident #4" },
  ],
}

const fakeExtractor =
  (out: ExtractedSkill): SkillExtractor =>
  async () =>
    out

const base = {
  name: "deploy-strands",
  target: "deploy-strands",
  version: "1.0.0",
  corpusSnapshotId: "snap-1",
  corpus: "…retrieved corpus…",
  extractorModel: "gpt-4o-2024-11-20",
  extractorVersion: "extract-v1",
  judgeModel: "google/gemini-1.5-pro-002",
}

describe("providerFamily", () => {
  it("maps ids to a coarse family", () => {
    expect(providerFamily("gpt-4o-2024-11-20")).toBe("openai")
    expect(providerFamily("google/gemini-1.5-pro-002")).toBe("google")
    expect(providerFamily("claude-3-5-sonnet-20241022")).toBe("anthropic")
  })
})

describe("compileSkill (§4)", () => {
  it("compiles a valid skill to a SKILL.md when extractor and judge are decorrelated", async () => {
    const r = await compileSkill({ ...base, extract: fakeExtractor(goodExtract) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.md).toContain("# deploy-strands")
      expect(r.md).toContain("[^1]: m1#c3 — runbook")
      expect(r.skill.directives[0]?.citations).toEqual([1])
    }
  })

  it("fails closed when the judge shares the extractor's family (§1a)", async () => {
    const r = await compileSkill({
      ...base,
      judgeModel: "gpt-4o-mini",
      extract: fakeExtractor(goodExtract),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toContain("different family")
  })

  it("fails closed on an uncited directive (L1 gate)", async () => {
    const r = await compileSkill({
      ...base,
      extract: fakeExtractor({ ...goodExtract, directives: [{ text: "Do it.", citations: [] }] }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes("no citation"))).toBe(true)
  })

  it("fails closed on a missing negative example (L1 gate)", async () => {
    const r = await compileSkill({
      ...base,
      extract: fakeExtractor({ ...goodExtract, negatives: [] }),
    })
    expect(r.ok).toBe(false)
  })
})
