/**
 * Live skill compile (Verified-Autonomy doctrine §4). Wraps the pure core with the two LLM
 * boundaries — a temperature-0 extractor and a DECORRELATED (§1a) L2 faithfulness judge —
 * plus the deterministic corpus snapshot id and the APL `skill.compile` regression span.
 * FAILS CLOSED at three gates: same-family extractor/judge, the L1 structural check, and
 * the L2 faithfulness threshold. Both LLM boundaries are injected (default: the knowledge
 * chat seam), so the whole orchestration unit-tests with fakes and no network.
 */

import type { EntailmentVerdict } from "@agenticmind/shared/lib/knowledge/faithfulness-entailment"

import {
  buildEntailmentUser,
  ENTAILMENT_SYSTEM,
  entailmentResponseSchema,
} from "@agenticmind/shared/lib/knowledge/faithfulness-entailment"
import { completeKnowledgeJson } from "@agenticmind/shared/lib/knowledge/llm"
import { Attr, SpanKind, withSpan } from "@agenticmind/shared/lib/observability/trace"
import { createHash } from "node:crypto"

import type { CompletenessReport, MissedItem } from "./completeness"
import type { CitationMeta, ExtractedSkillLlm } from "./extract"
import type { SkillFaithfulnessReport } from "./faithfulness"
import type { CompiledSkill } from "./types"

import { providerFamily } from "./compile"
import {
  buildCompletenessUser,
  COMPLETENESS_SYSTEM,
  completenessReport,
  completenessResponseSchema,
} from "./completeness"
import {
  assembleExtractedSkill,
  buildExtractUser,
  EXTRACT_SYSTEM,
  extractedSkillLlmSchema,
} from "./extract"
import { buildSkillClaims, skillFaithfulnessReport } from "./faithfulness"
import { checkSkillStructure, renderSkillMd } from "./skill-md"

/** A retrieved corpus chunk, in citation order (chunk index i → marker i+1). */
export type CorpusChunk = { body: string; materialId: string; chunk?: string; title: string }

export type SkillCompileLiveInput = {
  name: string
  target: string
  version: string
  extractorModel: string
  extractorVersion: string
  /** MUST be a different model family than the extractor (§1a) — fail-closed otherwise. */
  judgeModel: string
  chunks: CorpusChunk[]
  /** L2 gate: min entailed/judged fraction. Defaults to 1.0 (every directive grounded). */
  faithfulnessThreshold?: number
  /** L2 completeness gate: min captured/(captured+missed). UNSET = advisory (record, never
   * block); set it to enforce a recall floor. Faithfulness stays the hard correctness gate. */
  completenessThreshold?: number
}

/** Injected LLM boundaries + clock — defaults call the real seam; tests pass fakes. */
export type SkillCompileDeps = {
  extract?: (system: string, user: string, model: string) => Promise<ExtractedSkillLlm>
  judge?: (
    system: string,
    user: string,
    model: string,
  ) => Promise<{ index: number; verdict: EntailmentVerdict }[]>
  completeness?: (system: string, user: string, model: string) => Promise<MissedItem[]>
  now?: () => string
}

export type SkillCompileLiveResult =
  | {
      ok: true
      skill: CompiledSkill
      md: string
      report: SkillFaithfulnessReport
      completeness: CompletenessReport
      corpusSnapshotId: string
      judgeVersionHash: string
    }
  | { ok: false; errors: string[] }

/** Deterministic id of a corpus slice — same chunk bodies → same id, so a recompile is
 * reproducible and a corpus change mints a new snapshot (no snapshot store needed). */
export const corpusSnapshotId = (chunks: readonly CorpusChunk[]): string =>
  createHash("sha256")
    .update(chunks.map((c) => `${c.materialId}:${c.chunk ?? ""}:${c.body}`).join("\n\0\n"))
    .digest("hex")
    .slice(0, 16)

/** Version hash of the judge identity (model + rubric) — changes invalidate the L2 verdict. */
export const judgeVersionHash = (judgeModel: string): string =>
  createHash("sha256").update([judgeModel, ENTAILMENT_SYSTEM].join(" ")).digest("hex").slice(0, 16)

const defaultExtract = async (
  system: string,
  user: string,
  model: string,
): Promise<ExtractedSkillLlm> => {
  const res = await completeKnowledgeJson({
    system,
    user,
    schema: extractedSkillLlmSchema,
    model,
    purpose: "skill extract",
  })
  if (res.isErr()) {
    throw new Error(res.error.message)
  }
  return res.value
}

const defaultJudge = async (
  system: string,
  user: string,
  model: string,
): Promise<{ index: number; verdict: EntailmentVerdict }[]> => {
  const res = await completeKnowledgeJson({
    system,
    user,
    schema: entailmentResponseSchema,
    model,
    purpose: "skill faithfulness",
  })
  if (res.isErr()) {
    throw new Error(res.error.message)
  }
  return res.value.verdicts
}

const defaultCompleteness = async (
  system: string,
  user: string,
  model: string,
): Promise<MissedItem[]> => {
  const res = await completeKnowledgeJson({
    system,
    user,
    schema: completenessResponseSchema,
    model,
    purpose: "skill completeness",
  })
  if (res.isErr()) {
    throw new Error(res.error.message)
  }
  return res.value.missed
}

/** Compile a skill end to end, fail-closed, with the L2 faithfulness gate + APL span. */
export const compileSkillLive = async (
  input: SkillCompileLiveInput,
  deps: SkillCompileDeps = {},
): Promise<SkillCompileLiveResult> =>
  withSpan("skill.compile", SpanKind.CHAIN, async (span): Promise<SkillCompileLiveResult> => {
    span.setAttribute("agenticmind.skill.target", input.target)
    span.setAttribute(Attr.LLM_MODEL, input.extractorModel)
    span.setAttribute("agenticmind.skill.judge_model", input.judgeModel)

    // Gate 1 (§1a): the L2 judge must be a different family than the extractor.
    if (providerFamily(input.extractorModel) === providerFamily(input.judgeModel)) {
      return {
        ok: false,
        errors: [
          `judge (${input.judgeModel}) shares the extractor's family "${providerFamily(input.judgeModel)}" — the L2 judge must be a different family (§1a)`,
        ],
      }
    }

    const extract = deps.extract ?? defaultExtract
    const judge = deps.judge ?? defaultJudge
    const completeness = deps.completeness ?? defaultCompleteness
    const now = deps.now ?? (() => new Date().toISOString())

    const numberedChunks = input.chunks.map((c) => c.body)
    const citationMeta = new Map<number, CitationMeta>(
      input.chunks.map((c, i) => [
        i + 1,
        {
          materialId: c.materialId,
          ...(c.chunk !== undefined ? { chunk: c.chunk } : {}),
          title: c.title,
        },
      ]),
    )
    const snippetByMarker = new Map<number, string>(input.chunks.map((c, i) => [i + 1, c.body]))
    const snapshotId = corpusSnapshotId(input.chunks)

    // Extract (temperature 0) → assemble → L1 structural gate (fail closed).
    const llm = await extract(
      EXTRACT_SYSTEM,
      buildExtractUser(input.target, numberedChunks),
      input.extractorModel,
    )
    const extracted = assembleExtractedSkill(llm, citationMeta)
    const jvHash = judgeVersionHash(input.judgeModel)
    const skill: CompiledSkill = {
      frontmatter: {
        name: input.name,
        target: input.target,
        version: input.version,
        corpusSnapshotId: snapshotId,
        extractorModel: input.extractorModel,
        extractorVersion: input.extractorVersion,
        judgeVersionHash: jvHash,
        compiledAt: now(),
      },
      triggers: extracted.triggers,
      directives: extracted.directives,
      negatives: extracted.negatives,
      citations: extracted.citations,
    }
    const structure = checkSkillStructure(skill)
    if (!structure.ok) {
      return { ok: false, errors: structure.errors }
    }

    // Gate 3 (L2): decorrelated faithfulness — every directive entailed by its citations.
    const claims = buildSkillClaims(skill, snippetByMarker)
    const verdicts = await judge(ENTAILMENT_SYSTEM, buildEntailmentUser(claims), input.judgeModel)
    const report = skillFaithfulnessReport(claims, verdicts, input.faithfulnessThreshold)
    skill.frontmatter.evalPassRate = report.evalPassRate

    span.setAttribute(Attr.CITATION_COUNT, skill.citations.length)
    span.setAttribute(Attr.GROUNDEDNESS, report.evalPassRate)
    span.setAttribute("agenticmind.skill.passed", report.passed)

    if (!report.passed) {
      return {
        ok: false,
        errors: [
          `L2 faithfulness ${report.evalPassRate} < threshold — ungrounded: ${report.contradicted.join("; ")}`,
        ],
      }
    }

    // Gate 4 (L2, decorrelated): completeness — skill-worthy corpus content the extractor
    // missed. Advisory by default (records the score + missed list); only blocks when the
    // caller sets completenessThreshold. Runs after faithfulness passes.
    const capturedCount = skill.directives.length + skill.negatives.length
    const missed = await completeness(
      COMPLETENESS_SYSTEM,
      buildCompletenessUser(skill, numberedChunks),
      input.judgeModel,
    )
    const completenessRep = completenessReport(
      capturedCount,
      missed,
      input.completenessThreshold ?? 0,
    )
    span.setAttribute("agenticmind.skill.completeness", completenessRep.completenessScore)
    span.setAttribute("agenticmind.skill.missed_count", completenessRep.missed.length)

    if (input.completenessThreshold !== undefined && !completenessRep.passed) {
      return {
        ok: false,
        errors: [
          `L2 completeness ${completenessRep.completenessScore} < ${input.completenessThreshold} — missed: ${completenessRep.missed.map((m) => m.text).join("; ")}`,
        ],
      }
    }

    return {
      ok: true,
      skill,
      md: renderSkillMd(skill),
      report,
      completeness: completenessRep,
      corpusSnapshotId: snapshotId,
      judgeVersionHash: jvHash,
    }
  })
