import type { EntailmentVerdict } from "@agenticmind/shared/lib/knowledge/faithfulness-entailment"

import { describe, expect, it } from "vitest"

import type { SkillCompileDeps, CorpusChunk } from "./compile-live"
import type { ExtractedSkillLlm } from "./extract"

import { compileSkillLive, corpusSnapshotId } from "./compile-live"

const chunks: CorpusChunk[] = [
  {
    body: "Run migrate deploy on prod; never run migrate dev (it can reset the DB).",
    materialId: "m1",
    chunk: "c1",
    title: "Strands deploy runbook",
  },
  {
    body: "make build_dev on the server dropped the prod DB.",
    materialId: "m2",
    title: "Incident #4",
  },
]

const goodLlm: ExtractedSkillLlm = {
  triggers: ["Use when deploying Strands to prod."],
  directives: [{ text: "Run migrate deploy, never migrate dev, on prod.", citations: [1] }],
  negatives: [{ text: "Do NOT run make build_dev on the server.", citations: [2] }],
}

const entailAll =
  (verdict: EntailmentVerdict) =>
  async (): Promise<{ index: number; verdict: EntailmentVerdict }[]> => [
    { index: 0, verdict },
    { index: 1, verdict },
  ]

const deps = (over: Partial<SkillCompileDeps> = {}): SkillCompileDeps => {
  return {
    extract: async () => goodLlm,
    judge: entailAll("entailed"),
    now: () => "2026-07-11T00:00:00.000Z",
    ...over,
  }
}

const input = (over: Record<string, unknown> = {}) => {
  return {
    name: "deploy-strands-safely",
    target: "deploy Strands to a droplet safely",
    version: "1.0.0",
    extractorModel: "gpt-4o-2024-11-20",
    judgeModel: "google/gemini-2.5-flash",
    extractorVersion: "extract-v1",
    chunks,
    ...over,
  }
}

describe("compileSkillLive (§4 live compile + L2 faithfulness)", () => {
  it("compiles a grounded, decorrelated skill and stamps provenance", async () => {
    const r = await compileSkillLive(input(), deps())
    expect(r.ok).toBe(true)
    if (!r.ok) {
      return
    }
    expect(r.report.evalPassRate).toBe(1)
    expect(r.skill.frontmatter.compiledAt).toBe("2026-07-11T00:00:00.000Z")
    expect(r.skill.frontmatter.corpusSnapshotId).toBe(corpusSnapshotId(chunks))
    expect(r.skill.frontmatter.evalPassRate).toBe(1)
    expect(r.skill.frontmatter.judgeVersionHash).toBe(r.judgeVersionHash)
    expect(r.md).toContain("migrate deploy")
    expect(r.md).toContain("[^1]:")
  })

  it("fails closed when the judge shares the extractor's family (§1a)", async () => {
    const r = await compileSkillLive(input({ judgeModel: "gpt-4o-2024-11-20" }), deps())
    expect(r.ok).toBe(false)
    if (r.ok) {
      return
    }
    expect(r.errors[0]).toContain("different family")
  })

  it("fails closed on the L1 structural gate (an uncited directive)", async () => {
    const uncited: ExtractedSkillLlm = {
      ...goodLlm,
      directives: [{ text: "Run migrate deploy.", citations: [] }],
    }
    const r = await compileSkillLive(input(), deps({ extract: async () => uncited }))
    expect(r.ok).toBe(false)
    if (r.ok) {
      return
    }
    expect(r.errors.some((e) => e.includes("no citation"))).toBe(true)
  })

  it("fails closed on the L2 faithfulness gate (a not_entailed directive)", async () => {
    const r = await compileSkillLive(input(), deps({ judge: entailAll("not_entailed") }))
    expect(r.ok).toBe(false)
    if (r.ok) {
      return
    }
    expect(r.errors[0]).toContain("L2 faithfulness")
  })

  it("drops a hallucinated citation marker so the L1 gate catches it", async () => {
    const badMarker: ExtractedSkillLlm = {
      ...goodLlm,
      directives: [{ text: "Do the thing.", citations: [9] }], // 9 has no chunk
    }
    const r = await compileSkillLive(input(), deps({ extract: async () => badMarker }))
    expect(r.ok).toBe(false)
    if (r.ok) {
      return
    }
    expect(r.errors.some((e) => e.includes("not defined") || e.includes("no citation"))).toBe(true)
  })
})

describe("corpusSnapshotId", () => {
  it("is deterministic for the same corpus and changes when a chunk body changes", () => {
    expect(corpusSnapshotId(chunks)).toBe(corpusSnapshotId(chunks))
    const edited = [{ ...chunks[0]!, body: "different" }, chunks[1]!]
    expect(corpusSnapshotId(edited)).not.toBe(corpusSnapshotId(chunks))
  })
})
