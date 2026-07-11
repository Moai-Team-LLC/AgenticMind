/**
 * SKILL.md emitter + structural L1 gate (Verified-Autonomy doctrine §4). Pure, no LLM:
 * a compiled skill renders to a machine-facing SKILL.md, and `checkSkillStructure`
 * enforces the contract — every directive/negative carries a resolvable citation,
 * triggers are non-empty, at least one negative example exists — so an uncited or
 * malformed skill FAILS COMPILATION before any judge is asked.
 */

import type { CompiledSkill, SkillInstruction } from "./types"

const markers = (instr: SkillInstruction): string => instr.citations.map((n) => `[^${n}]`).join("")

const renderInstruction = (instr: SkillInstruction): string =>
  `- ${instr.text} ${markers(instr)}`.trimEnd()

/** Render a compiled skill to its machine-facing SKILL.md string. */
export const renderSkillMd = (skill: CompiledSkill): string => {
  const fm = skill.frontmatter
  const front = [
    "---",
    `name: ${fm.name}`,
    `target: ${fm.target}`,
    `version: ${fm.version}`,
    `corpusSnapshotId: ${fm.corpusSnapshotId}`,
    `extractorModel: ${fm.extractorModel}`,
    `extractorVersion: ${fm.extractorVersion}`,
    ...(fm.judgeVersionHash !== undefined ? [`judgeVersionHash: ${fm.judgeVersionHash}`] : []),
    ...(fm.evalPassRate !== undefined ? [`evalPassRate: ${fm.evalPassRate}`] : []),
    ...(fm.gitSha !== undefined ? [`gitSha: ${fm.gitSha}`] : []),
    "---",
  ].join("\n")

  const citations = skill.citations
    .slice()
    .toSorted((a, b) => a.marker - b.marker)
    .map(
      (c) =>
        `[^${c.marker}]: ${c.materialId}${typeof c.chunk === "string" && c.chunk.length > 0 ? `#${c.chunk}` : ""} — ${c.title}`,
    )
    .join("\n")

  return [
    front,
    "",
    `# ${fm.name}`,
    "",
    "## Triggers",
    ...skill.triggers.map((t) => `- ${t}`),
    "",
    "## Directives",
    ...skill.directives.map(renderInstruction),
    "",
    "## Negative examples",
    ...skill.negatives.map(renderInstruction),
    "",
    "## Citations",
    citations,
    "",
  ].join("\n")
}

export type StructureCheck = {
  ok: boolean
  errors: string[]
}

/**
 * The L1 structural gate — pure, no LLM. Fails closed: a skill that violates the
 * citation/negative/trigger contract is not writable.
 */
export const checkSkillStructure = (skill: CompiledSkill): StructureCheck => {
  const errors: string[] = []
  const defined = new Set(skill.citations.map((c) => c.marker))

  if (skill.triggers.length === 0) {
    errors.push("no triggers (the skill has no router)")
  }
  if (skill.directives.length === 0) {
    errors.push("no directives (the skill is empty)")
  }
  if (skill.negatives.length === 0) {
    errors.push("no negative examples (>= 1 required)")
  }

  const checkCited = (instr: SkillInstruction, kind: string, i: number): void => {
    if (instr.citations.length === 0) {
      errors.push(`${kind} #${i + 1} "${instr.text}" has no citation`)
      return
    }
    for (const m of instr.citations) {
      if (!defined.has(m)) {
        errors.push(`${kind} #${i + 1} cites [^${m}] which is not defined`)
      }
    }
  }
  for (const [i, d] of skill.directives.entries()) {
    checkCited(d, "directive", i)
  }
  for (const [i, n] of skill.negatives.entries()) {
    checkCited(n, "negative", i)
  }

  return { ok: errors.length === 0, errors }
}

/** Fraction of instructions (directives + negatives) that carry >= 1 citation; the L1
 * gate requires this to be exactly 1.0. */
export const citationCoverage = (skill: CompiledSkill): number => {
  const all = [...skill.directives, ...skill.negatives]
  if (all.length === 0) {
    return 0
  }
  return all.filter((i) => i.citations.length > 0).length / all.length
}

const CITE_RE = /\[\^(\d+)\]/g

const parseInstruction = (line: string): SkillInstruction => {
  const citations: number[] = []
  let m: RegExpExecArray | null
  CITE_RE.lastIndex = 0
  while ((m = CITE_RE.exec(line)) !== null) {
    citations.push(Number(m[1]))
  }
  const text = line.replace(/^-\s*/, "").replace(CITE_RE, "").trim()
  return { text, citations }
}

export type ParsedSkill = {
  name: string
  version: string
  triggers: string[]
  directives: SkillInstruction[]
  negatives: SkillInstruction[]
  citationMarkers: number[]
}

/**
 * Structural parse of a rendered SKILL.md — enough to lint/diff a skill and prove the
 * emitted format is machine-readable (round-trips with renderSkillMd). Not a general
 * Markdown parser; it reads the sections this module emits.
 */
export const parseSkillMd = (md: string): ParsedSkill => {
  const lines = md.split("\n")
  const name =
    lines
      .find((l) => l.startsWith("name:"))
      ?.slice("name:".length)
      .trim() ?? ""
  const version =
    lines
      .find((l) => l.startsWith("version:"))
      ?.slice("version:".length)
      .trim() ?? ""

  const section = (heading: string): string[] => {
    const start = lines.findIndex((l) => l.trim() === heading)
    if (start === -1) {
      return []
    }
    const body: string[] = []
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i] ?? ""
      if (l.startsWith("## ") || l.startsWith("# ")) {
        break
      }
      if (l.trim().startsWith("- ")) {
        body.push(l.trim())
      }
    }
    return body
  }

  const triggers = section("## Triggers").map((l) => l.replace(/^-\s*/, "").trim())
  const directives = section("## Directives").map((l) => parseInstruction(l))
  const negatives = section("## Negative examples").map((l) => parseInstruction(l))
  const citationMarkers: number[] = []
  for (const l of lines) {
    const m = /^\[\^(\d+)\]:/.exec(l.trim())
    if (m) {
      citationMarkers.push(Number(m[1]))
    }
  }
  return { name, version, triggers, directives, negatives, citationMarkers }
}
