/**
 * Recency-aware ranking boost — ported from services/knowledge/internal/rerank
 * (recency.go). When two materials match similarly well, the fresher one wins,
 * closing the failure mode where the LLM never sees a recently updated source.
 * Pure functions; callers re-sort by the boosted score.
 */

export type RecencyConfig = {
  /** Multiplicative boost for a brand-new item: score * (1 + maxBoost*factor). */
  maxBoost: number
  /** Items updated within this many days get the full boost. */
  fullBoostDays: number
  /** Items older than this get no boost; linear decay in between. */
  zeroBoostDays: number
}

/** V1 default: +20% max, full boost ≤30d, zero boost ≥365d. */
export const defaultRecencyConfig = (): RecencyConfig => {
  return {
    maxBoost: 0.2,
    fullBoostDays: 30,
    zeroBoostDays: 365,
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Freshness factor in [0,1]. null/undefined timestamps (unknown age) get 0 —
 * we don't reward unknown ages.
 */
export const recencyFactor = (
  updatedAt: Date | null | undefined,
  cfg: RecencyConfig,
  now: Date = new Date(),
): number => {
  if (updatedAt === null || updatedAt === undefined) {
    return 0
  }
  const fullBoostDays = cfg.fullBoostDays < 0 ? 0 : cfg.fullBoostDays
  const ageDays = (now.getTime() - updatedAt.getTime()) / MS_PER_DAY

  if (cfg.zeroBoostDays <= fullBoostDays) {
    // Misconfiguration — treat as a binary cliff at fullBoostDays.
    return ageDays <= fullBoostDays ? 1 : 0
  }
  if (ageDays <= fullBoostDays) {
    return 1
  }
  if (ageDays >= cfg.zeroBoostDays) {
    return 0
  }

  const span = cfg.zeroBoostDays - fullBoostDays
  const progress = (ageDays - fullBoostDays) / span
  const factor = 1 - progress
  return factor < 0 ? 0 : Math.min(1, factor)
}

/** Final score after the recency uplift. Pure; caller sorts. */
export const boost = (
  baseScore: number,
  updatedAt: Date | null | undefined,
  cfg: RecencyConfig,
  now?: Date,
): number => {
  const factor = recencyFactor(updatedAt, cfg, now)
  if (factor === 0 || cfg.maxBoost === 0) {
    return baseScore
  }
  return baseScore * (1 + cfg.maxBoost * factor)
}
