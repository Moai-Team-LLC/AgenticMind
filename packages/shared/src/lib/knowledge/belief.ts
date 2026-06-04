/**
 * Pure belief logic — identity, conflict detection, and consolidation rules.
 * No DB / LLM (those live in query/knowledge/beliefs.ts and the worker sweep).
 *
 * A belief is one actor's subject-predicate-object claim. Two beliefs with the
 * same (subject, predicate) but different object are in CONFLICT — either the
 * world changed (belief revision over valid-time) or actors disagree (resolve
 * by corroboration). This module decides identity and who wins.
 */

export type BeliefClaim = {
  actorUuid: string | null
  subject: string
  predicate: string
  object: string
  confidence: number
  /** Tx-time the claim was recorded — recency tiebreaker. */
  recordedAt?: Date
}

/** Collapse case + all whitespace so "12.5 %" and "12.5%" compare equal. */
const norm = (s: string): string => s.trim().toLowerCase().replaceAll(/\s+/gu, "")

/** Stable identity of "what this belief is about" — the revision/conflict key. */
export const beliefKey = (subject: string, predicate: string): string =>
  `${norm(subject)}|${norm(predicate)}`

const objectKey = (object: string): string => norm(object)

export type ConflictGroup = {
  key: string
  subject: string
  predicate: string
  /** Distinct objects claimed, each with its supporting claims. */
  variants: { object: string; claims: BeliefClaim[] }[]
}

/**
 * Groups claims by (subject, predicate) and returns only the groups where ≥2
 * distinct objects are claimed — i.e. genuine conflicts to resolve.
 */
export const detectConflicts = (claims: readonly BeliefClaim[]): ConflictGroup[] => {
  const byKey = new Map<
    string,
    { subject: string; predicate: string; objects: Map<string, BeliefClaim[]> }
  >()
  for (const c of claims) {
    const key = beliefKey(c.subject, c.predicate)
    let group = byKey.get(key)
    if (group === undefined) {
      group = { subject: c.subject, predicate: c.predicate, objects: new Map() }
      byKey.set(key, group)
    }
    const ok = objectKey(c.object)
    const list = group.objects.get(ok)
    if (list === undefined) {
      group.objects.set(ok, [c])
    } else {
      list.push(c)
    }
  }

  const conflicts: ConflictGroup[] = []
  for (const [key, group] of byKey) {
    if (group.objects.size < 2) {
      continue
    }
    conflicts.push({
      key,
      subject: group.subject,
      predicate: group.predicate,
      variants: [...group.objects.values()].map((groupClaims) => {
        return {
          object: groupClaims[0]?.object ?? "",
          claims: groupClaims,
        }
      }),
    })
  }
  return conflicts
}

/** Agent-facing view of a contested belief: the competing objects, each tagged
 * with the source (actor) and date of its most-recent assertion. */
export type ContestedClaim = {
  subject: string
  predicate: string
  claims: { object: string; actorUuid: string | null; recordedAt: Date | null }[]
}

/**
 * Surfaces conflicts instead of silently resolving them: maps detected conflict
 * groups to a compact, agent-consumable shape so a caller can see "this is
 * contested: object A (src, date) vs object B (src, date)" and decide for itself.
 */
export const summarizeContested = (claims: readonly BeliefClaim[]): ContestedClaim[] =>
  detectConflicts(claims).map((g) => {
    return {
      subject: g.subject,
      predicate: g.predicate,
      claims: g.variants.map((v) => {
        const newest = v.claims.reduce((a, b) =>
          (b.recordedAt?.getTime() ?? 0) > (a.recordedAt?.getTime() ?? 0) ? b : a,
        )
        return {
          object: v.object,
          actorUuid: newest.actorUuid,
          recordedAt: newest.recordedAt ?? null,
        }
      }),
    }
  })

/**
 * Resolution rule for consolidating conflicting claims into one shared belief.
 * Ranks each candidate object by (1) distinct-actor corroboration count,
 * (2) summed confidence, (3) recency. Returns the winner with a consolidated
 * confidence in [0,1] that rises with corroboration. Returns null on no claims.
 *
 * This is a deterministic prior — the LLM judge can override on the rare close
 * call, but most conflicts resolve here without a model call.
 */
export const resolveConflict = (
  claims: readonly BeliefClaim[],
): { object: string; confidence: number; corroborators: number } | null => {
  if (claims.length === 0) {
    return null
  }

  const byObject = new Map<string, BeliefClaim[]>()
  for (const c of claims) {
    const ok = objectKey(c.object)
    const list = byObject.get(ok)
    if (list === undefined) {
      byObject.set(ok, [c])
    } else {
      list.push(c)
    }
  }

  let best: { object: string; actors: number; sumConf: number; latest: number } | null = null
  for (const list of byObject.values()) {
    const actors = new Set(list.map((c) => c.actorUuid ?? "shared")).size
    const sumConf = list.reduce((s, c) => s + c.confidence, 0)
    const latest = Math.max(...list.map((c) => c.recordedAt?.getTime() ?? 0))
    const cand = { object: list[0]?.object ?? "", actors, sumConf, latest }
    if (
      best === null ||
      cand.actors > best.actors ||
      (cand.actors === best.actors && cand.sumConf > best.sumConf) ||
      (cand.actors === best.actors && cand.sumConf === best.sumConf && cand.latest > best.latest)
    ) {
      best = cand
    }
  }
  if (best === null) {
    return null
  }

  const winningClaims = claims.filter((c) => objectKey(c.object) === objectKey(best.object))
  // Confidence rises with corroboration (1 - 0.5^actors), blended 50/50 with
  // The average confidence of the winning claims.
  const corroborationBoost = 1 - 0.5 ** best.actors
  const avgConf = best.sumConf / winningClaims.length
  const confidence = Math.min(1, Math.max(0, 0.5 * corroborationBoost + 0.5 * avgConf))
  return { object: best.object, confidence, corroborators: best.actors }
}
