/**
 * Source-trust weighting — fold a material's content lifecycle + trust tier into
 * its retrieval score, so stale or low-trust sources don't silently win. Applied
 * after the recency boost in the ask pipeline; pure + unit-tested here.
 *
 * lifecycle: active (full weight) → deprecated → superseded → archived (near-zero,
 * effectively retired but still reachable as a last resort). trust_tier: a rank
 * (0 = unverified/default) that multiplicatively boosts higher-trust sources —
 * e.g. a signed policy outranks a historical note on the same fact.
 */

export const LIFECYCLES = ["active", "deprecated", "superseded", "archived"] as const
export type Lifecycle = (typeof LIFECYCLES)[number]

export type TrustConfig = {
  /** Multiplicative score weight per lifecycle state. */
  lifecycleWeight: Record<Lifecycle, number>
  /** Fractional score bump per trust-tier level above 0 (e.g. 0.05 = +5%/level). */
  tierBoostPerLevel: number
}

export const defaultTrustConfig = (): TrustConfig => {
  return {
    lifecycleWeight: { active: 1, deprecated: 0.6, superseded: 0.3, archived: 0.05 },
    tierBoostPerLevel: 0.05,
  }
}

const LIFECYCLE_SET = new Set<string>(LIFECYCLES)

/**
 * Adjusts a (already recency-boosted) retrieval score by the source's lifecycle
 * and trust tier. An unknown lifecycle is treated as neutral (weight 1). Negative
 * trust tiers are floored at 0; the result is clamped ≥ 0. Pure.
 */
export const applyTrust = (
  score: number,
  lifecycle: string,
  trustTier: number,
  cfg: TrustConfig = defaultTrustConfig(),
): number => {
  const weight = LIFECYCLE_SET.has(lifecycle) ? cfg.lifecycleWeight[lifecycle as Lifecycle] : 1
  const tierMultiplier = 1 + Math.max(0, trustTier) * cfg.tierBoostPerLevel
  return Math.max(0, score * weight * tierMultiplier)
}
