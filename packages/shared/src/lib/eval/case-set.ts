/**
 * Merging a regenerated eval case set into the committed one (eval/cases.json).
 *
 * The case generator (scripts/build-eval-cases.ts) owns the failure modes it
 * emits; every other case in the file is hand-written (faithfulness, pii_leak,
 * stale_version, …) and has no source but the file itself. A regeneration keeps
 * those verbatim, after the generated cases, and refuses to lose any existing case
 * id unless it is named explicitly — so a re-run can never quietly shrink the
 * suite the gate measures.
 */

import type { Result } from "neverthrow"

import { err, ok } from "neverthrow"

type CaseLike = { id: string; failureMode: string }

export type MergedCases<T> = {
  cases: T[]
  /** Hand-written case ids carried over unchanged. */
  kept: string[]
  /** Existing case ids dropped because the caller named them. */
  dropped: string[]
}

export const mergeGeneratedCases = <T extends CaseLike>(
  existing: readonly T[],
  generated: readonly T[],
  allowDrop: readonly string[] = [],
): Result<MergedCases<T>, string> => {
  const ownedModes = new Set(generated.map((c) => c.failureMode))
  const kept = existing.filter((c) => !ownedModes.has(c.failureMode))
  const cases = [...generated, ...kept]

  const ids = cases.map((c) => c.id)
  const dupIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  if (dupIds.length > 0) {
    return err(`a hand-written case reuses a generated id: ${dupIds.join(", ")}`)
  }

  const outIds = new Set(ids)
  const lost = existing.map((c) => c.id).filter((id) => !outIds.has(id))
  const unexpected = lost.filter((id) => !allowDrop.includes(id))
  if (unexpected.length > 0) {
    return err(
      `regeneration would drop ${unexpected.length} existing case(s): ${unexpected.join(", ")}. ` +
        "A hand-written case must use a failure mode the generator does not emit; to drop " +
        "a case on purpose, name it in EVAL_CASES_ALLOW_DROP.",
    )
  }
  const stale = allowDrop.filter((id) => !lost.includes(id))
  if (stale.length > 0) {
    return err(`EVAL_CASES_ALLOW_DROP names case(s) that would not be dropped: ${stale.join(", ")}`)
  }

  return ok({ cases, kept: kept.map((c) => c.id), dropped: lost })
}
