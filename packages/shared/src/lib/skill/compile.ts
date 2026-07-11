/**
 * Skill compile orchestration (Verified-Autonomy doctrine §4). Pure over injected
 * seams — the LLM extraction is a `SkillExtractor` fn (faked in tests; the live impl
 * retrieves the corpus slice and runs a temperature-0 extractor). Compilation FAILS
 * CLOSED: it refuses when the extractor and judge share a model family (§1a) or when the
 * L1 structural gate rejects the extracted skill, and only then renders the SKILL.md.
 * git + the decorrelated L2 eval judge + the APL regression span wrap THIS in the
 * integration; here we keep the deterministic, testable heart.
 */

import type { CompiledSkill, SkillCitation, SkillInstruction } from "./types"

import { checkSkillStructure, renderSkillMd } from "./skill-md"

/** What the injected LLM extractor returns from the corpus slice. */
export interface ExtractedSkill {
  triggers: string[]
  directives: SkillInstruction[]
  negatives: SkillInstruction[]
  citations: SkillCitation[]
}

/** The extraction seam. Live: corpus retriever + temperature-0 extractor. Test: a fake. */
export type SkillExtractor = (corpus: string) => Promise<ExtractedSkill>

export interface CompileInput {
  name: string
  target: string
  version: string
  corpusSnapshotId: string
  corpus: string
  /** Pinned extractor model snapshot + its convention version (reproducibility). */
  extractorModel: string
  extractorVersion: string
  /** The L2 judge model — MUST be a different family than the extractor (§1a). */
  judgeModel: string
  extract: SkillExtractor
}

export type CompileResult =
  | { ok: true; skill: CompiledSkill; md: string }
  | { ok: false; errors: string[] }

/** Coarse provider family of a model id (possibly `provider/model`). */
export const providerFamily = (model: string): string => {
  const m = model.toLowerCase()
  const slash = m.indexOf("/")
  const bare = slash > 0 ? m.slice(slash + 1) : m
  if (/^(gpt-|o1|o3|o4|chatgpt|text-)/u.test(bare) || m.includes("openai")) return "openai"
  if (bare.includes("claude") || m.includes("anthropic")) return "anthropic"
  if (bare.includes("gemini") || m.includes("google")) return "google"
  if (/llama|mistral|mixtral|qwen|deepseek|gemma/u.test(bare)) return "open-weights"
  return slash > 0 ? m.slice(0, slash) : "unknown"
}

/** Compile a skill fail-closed. */
export const compileSkill = async (input: CompileInput): Promise<CompileResult> => {
  if (providerFamily(input.extractorModel) === providerFamily(input.judgeModel)) {
    return {
      ok: false,
      errors: [
        `judge (${input.judgeModel}) shares the extractor's family "${providerFamily(input.judgeModel)}" — the L2 judge must be a different family (§1a)`,
      ],
    }
  }

  const extracted = await input.extract(input.corpus)
  const skill: CompiledSkill = {
    frontmatter: {
      name: input.name,
      target: input.target,
      version: input.version,
      corpusSnapshotId: input.corpusSnapshotId,
      extractorModel: input.extractorModel,
      extractorVersion: input.extractorVersion,
    },
    triggers: extracted.triggers,
    directives: extracted.directives,
    negatives: extracted.negatives,
    citations: extracted.citations,
  }

  const structure = checkSkillStructure(skill)
  if (!structure.ok) return { ok: false, errors: structure.errors }

  return { ok: true, skill, md: renderSkillMd(skill) }
}
