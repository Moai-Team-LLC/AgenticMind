/**
 * Signal-derived eval cases — the privacy-preserving half of the read-path
 * closed loop (Lever 3.3). Real queries that earned a NET-POSITIVE sum of agent
 * feedback signals (verified_supported / eval_passed / downstream_success …) and
 * were captured under the opt-in eval-harvest flag become regression cases: "this
 * real, agent-validated query must keep producing a grounded, cited, non-abstain
 * answer." The corpus-adaptive tuner (scripts/tune.ts) optimises retrieval
 * parameters against these alongside the curated corpus — so the engine tunes to
 * THIS deployment's real traffic, not just a static eval set.
 *
 * Pure: no db/llm imports (the harvest query lives in ask-telemetry.ts), so it
 * unit-tests with canned rows. Net-negative/contested queries are excluded — we
 * never assert a grounded answer for something production flagged as wrong.
 */

import type { HarvestedQuery } from "@agenticmind/shared/database/query/knowledge/ask-telemetry"
import type { EvalCase } from "@agenticmind/shared/lib/eval/harness"

/** Below this many characters a "query" is treated as noise, not a real case. */
const MIN_QUERY_CHARS = 8
/** Upper bound on synthesised cases, so one tuner pass stays bounded. */
const MAX_CASES = 50
/** Default groundedness floor a signalled query's answer must keep reaching. */
const DEFAULT_MIN_GROUNDEDNESS = 0.5

const normalise = (s: string): string => s.trim().toLowerCase().replaceAll(/\s+/gu, " ")

/** Deterministic short id (polynomial rolling hash, mod a large prime — no bitwise
 * ops) so the same query yields a stable case id across runs. */
const stableId = (s: string): string => {
  let h = 0
  for (const ch of s) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 2_147_483_647
  }
  return h.toString(36)
}

/**
 * Maps harvested (net-positive) production queries to regression eval cases,
 * deduped by normalised text and capped. Each case asserts the engine still
 * answers (not abstain), cites ≥1 source, and clears the groundedness floor.
 */
export const signalCasesFromHarvest = (
  rows: readonly HarvestedQuery[],
  opts?: { minGroundedness?: number; maxCases?: number },
): EvalCase[] => {
  const minGroundedness = opts?.minGroundedness ?? DEFAULT_MIN_GROUNDEDNESS
  const maxCases = opts?.maxCases ?? MAX_CASES
  const seen = new Set<string>()
  const out: EvalCase[] = []
  for (const row of rows) {
    if (out.length >= maxCases) {
      break
    }
    const query = row.questionText.trim()
    if (query.length < MIN_QUERY_CHARS || row.netStrength <= 0) {
      continue
    }
    const key = normalise(query)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push({
      id: `signal-${stableId(key)}`,
      failureMode: "production_signal",
      query,
      assertions: { expectAbstain: false, minCitations: 1, minGroundedness },
    })
  }
  return out
}
