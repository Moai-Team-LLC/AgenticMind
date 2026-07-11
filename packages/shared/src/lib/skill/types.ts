/**
 * Skill-compiler types (Verified-Autonomy doctrine §4). A skill is compiled from the
 * corpus into a machine-facing SKILL.md: imperative directives, explicit triggers,
 * negative examples, and a CITATION on every instruction so each rule is traceable and
 * falsifiable. These are the pure shapes; the retrieval + LLM-extraction + eval-gate +
 * git steps live in the compile integration.
 */

export interface SkillCitation {
  /** Footnote marker number — `[^1]` → 1. */
  marker: number
  /** Corpus material this citation resolves to. */
  materialId: string
  /** Optional chunk / section within the material. */
  chunk?: string
  /** Human-readable title for the footnote. */
  title: string
}

export interface SkillInstruction {
  /** Imperative one-liner ("Do X." / "Never Y."). */
  text: string
  /** Citation markers backing this instruction — the structural gate requires >= 1. */
  citations: number[]
}

export interface SkillFrontmatter {
  name: string
  /** The behaviour this skill encodes, e.g. "deploy-strands-safely". */
  target: string
  /** Semver, bumped on every recompile. */
  version: string
  /** Snapshot id of the corpus slice the skill was compiled from. */
  corpusSnapshotId: string
  /** Extractor model snapshot + its prompt/convention version (reproducibility). */
  extractorModel: string
  extractorVersion: string
  /** Judge identity hash from the L2 eval (set by the compile integration). */
  judgeVersionHash?: string
  /** L2 eval pass rate at compile time. */
  evalPassRate?: number
  /** Git sha the compiled SKILL.md was committed at. */
  gitSha?: string
  /** ISO timestamp — stamped by the integration (kept out of the pure core). */
  compiledAt?: string
}

export interface CompiledSkill {
  frontmatter: SkillFrontmatter
  /** "Use when …" router phrases — must be non-empty. */
  triggers: string[]
  /** "Do X." / "Never Y." — each MUST carry >= 1 citation. */
  directives: SkillInstruction[]
  /** "Do NOT …" counter-cases mined from incidents/failures — >= 1 required. */
  negatives: SkillInstruction[]
  citations: SkillCitation[]
}

/** A golden case the compiled skill's L2 eval judges (the LLM judge lives in the
 * compile integration; kept here so the eval-set shape is shared). */
export interface SkillEvalCase {
  input: string
  /** Behaviour that applying the skill should produce. */
  expectBehavior: string
}
