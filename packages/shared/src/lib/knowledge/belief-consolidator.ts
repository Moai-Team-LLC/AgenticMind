/**
 * Belief consolidation sweep — promotes corroborated PRIVATE beliefs into
 * SHARED/collective memory. For every (subject, predicate) that ≥ N agents hold
 * a current belief about, the deterministic `resolveConflict` rule picks the
 * winning object (corroboration → confidence → recency); a clear winner is
 * written as a shared belief (actor_uuid NULL, source "consolidation"),
 * superseding any prior shared belief. This is how the summed relevant memory
 * gets stored and optimised — the same compounding idea the answer→card loop uses.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { BeliefClaim } from "@agenticmind/shared/lib/knowledge/belief"

import {
  assertBelief,
  currentBeliefsFor,
  findConsolidationCandidates,
} from "@agenticmind/shared/database/query/knowledge/beliefs"
import { resolveConflict } from "@agenticmind/shared/lib/knowledge/belief"
import { ResultAsync } from "neverthrow"

export const sweepConsolidateBeliefs = (props: {
  tx: Transaction
  minActors?: number
  maxGroups?: number
}): ResultAsync<{ scanned: number; consolidated: number }, never> => {
  const minActors = props.minActors ?? 2
  return ResultAsync.fromSafePromise(
    (async () => {
      const candidates = await findConsolidationCandidates({
        tx: props.tx,
        minActors,
        limit: props.maxGroups,
      }).unwrapOr([])

      let consolidated = 0
      for (const c of candidates) {
        const rows = await currentBeliefsFor({
          tx: props.tx,
          subject: c.subject,
          predicate: c.predicate,
        }).unwrapOr([])

        const claims: BeliefClaim[] = rows
          .filter((r) => r.actorUuid !== null)
          .map((r) => {
            return {
              actorUuid: r.actorUuid,
              subject: r.subject,
              predicate: r.predicate,
              object: r.object,
              confidence: r.confidence,
              recordedAt: r.recordedAt ?? undefined,
            }
          })

        const resolved = resolveConflict(claims)
        if (resolved !== null && resolved.corroborators >= minActors) {
          const w = await assertBelief({
            tx: props.tx,
            belief: {
              actorUuid: null,
              subject: c.subject,
              predicate: c.predicate,
              object: resolved.object,
              confidence: resolved.confidence,
              sourceKind: "consolidation",
            },
            revise: true,
          })
          if (w.isOk()) {
            consolidated += 1
          }
        }
      }
      return { scanned: candidates.length, consolidated }
    })(),
  )
}
