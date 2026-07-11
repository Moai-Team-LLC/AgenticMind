/**
 * L2 faithfulness gate (Verified-Autonomy doctrine §4 + §1a). A compiled skill is only
 * as trustworthy as the corpus behind it: this reuses the Tier-B entailment judge to check
 * that every directive/negative is ENTAILED by its own cited snippet(s) — the skill is a
 * faithful projection of the corpus, not the extractor's invention. The judge runs on a
 * DIFFERENT model family than the extractor (wired in compile-live.ts), so a same-mind
 * pass cannot co-sign a hallucinated directive.
 *
 * Pure — builds the (claim, snippet) pairs and scores the verdicts; the LLM call lives in
 * the integration. NOTE the deliberate limit: this proves faithfulness (skill ⊂ corpus),
 * NOT completeness (that the extractor picked the RIGHT chunks). Completeness is a separate
 * reviewer, out of scope here.
 */

import type {
  EntailmentClaim,
  EntailmentVerdict,
} from "@agenticmind/shared/lib/knowledge/faithfulness-entailment"

import { aggregateEntailment } from "@agenticmind/shared/lib/knowledge/faithfulness-entailment"

import type { CompiledSkill } from "./types"

/** Strict by default: every judged directive must be entailed by its citations. */
export const DEFAULT_FAITHFULNESS_THRESHOLD = 1

export type SkillFaithfulnessReport = {
  /** entailed / judged (unknown excluded); 1.0 when nothing was judgeable. */
  evalPassRate: number
  /** Directives/negatives whose own cited snippet does not support them. */
  contradicted: string[]
  /** True when evalPassRate >= threshold — the L2 gate. */
  passed: boolean
}

/**
 * One entailment claim per directive + negative, paired with the snippet text of the
 * markers it cites. A marker with no snippet is dropped (an uncited claim is caught by L1
 * upstream), so the judge only ever scores against real corpus text.
 */
export const buildSkillClaims = (
  skill: CompiledSkill,
  snippetByMarker: ReadonlyMap<number, string>,
): EntailmentClaim[] => {
  const claims: EntailmentClaim[] = []
  for (const instr of [...skill.directives, ...skill.negatives]) {
    const snippets: string[] = []
    for (const marker of instr.citations) {
      const snippet = snippetByMarker.get(marker)
      if (snippet !== undefined && snippet.length > 0) {
        snippets.push(snippet)
      }
    }
    claims.push({ claim: instr.text, snippets })
  }
  return claims
}

/** Scores the judge's per-claim verdicts into the L2 report (pure). */
export const skillFaithfulnessReport = (
  claims: readonly EntailmentClaim[],
  verdicts: readonly { index: number; verdict: EntailmentVerdict }[],
  threshold: number = DEFAULT_FAITHFULNESS_THRESHOLD,
): SkillFaithfulnessReport => {
  const tierB = aggregateEntailment(claims, verdicts)
  return {
    evalPassRate: tierB.semanticGroundedness,
    contradicted: tierB.contradictedClaims,
    passed: tierB.semanticGroundedness >= threshold,
  }
}
