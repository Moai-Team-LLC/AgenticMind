/**
 * Fleet health / drift summary (anti-hallucination detection D) — the pure half.
 * Given the per-status answer counts over a window (from ask_telemetry), compute
 * the rate of low-quality answers and raise concerns when a rate crosses a floor.
 * This catches SYSTEMIC degradation the per-answer guards don't — a model swap,
 * corpus drift, or a regression that quietly lifts the `needs_review` /
 * `unsupported` rate across the fleet.
 *
 * Pure: `scripts/health.ts` runs the GROUP BY and feeds the rows here.
 */

export type StatusCount = { status: string | null; count: number }

export type HealthThresholds = {
  /** Max acceptable share of needs_review answers. */
  needsReview?: number
  /** Max acceptable share of unsupported answers. */
  unsupported?: number
  /** Max acceptable share of conflicted answers. */
  conflicted?: number
  /** Max acceptable share of rows with no recorded status (instrumentation gap). */
  untracked?: number
}

export const DEFAULT_HEALTH_THRESHOLDS: Required<HealthThresholds> = {
  needsReview: 0.15,
  unsupported: 0.25,
  conflicted: 0.1,
  untracked: 0.5,
}

export type HealthSummary = {
  total: number
  byStatus: Record<string, number>
  rate: Record<string, number>
  concerns: string[]
}

const STATUS_KEYS = ["needsReview", "unsupported", "conflicted", "untracked"] as const
const STATUS_OF: Record<(typeof STATUS_KEYS)[number], string> = {
  needsReview: "needs_review",
  unsupported: "unsupported",
  conflicted: "conflicted",
  untracked: "__null__",
}

/**
 * Summarise answer-status counts into rates + threshold concerns. Pure +
 * deterministic. A null status (older rows or an instrumentation gap) is bucketed
 * as `__null__` so a monitoring blind spot is itself a flaggable concern.
 */
export const summarizeAskHealth = (
  rows: readonly StatusCount[],
  thresholds: HealthThresholds = {},
): HealthSummary => {
  const t = { ...DEFAULT_HEALTH_THRESHOLDS, ...thresholds }
  const byStatus: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    const key = r.status ?? "__null__"
    byStatus[key] = (byStatus[key] ?? 0) + r.count
    total += r.count
  }
  const rate: Record<string, number> = {}
  for (const key of Object.keys(byStatus)) {
    rate[key] = total === 0 ? 0 : (byStatus[key] ?? 0) / total
  }
  const concerns: string[] = []
  if (total > 0) {
    for (const key of STATUS_KEYS) {
      const status = STATUS_OF[key]
      const observed = rate[status] ?? 0
      if (observed > t[key]) {
        const label = status === "__null__" ? "untracked (no status)" : status
        concerns.push(
          `${label} rate ${(observed * 100).toFixed(1)}% exceeds ${(t[key] * 100).toFixed(0)}% threshold`,
        )
      }
    }
  }
  return { total, byStatus, rate, concerns }
}
