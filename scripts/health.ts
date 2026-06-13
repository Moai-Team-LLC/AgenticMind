/**
 * Fleet health monitor (anti-hallucination detection D) — answer-status drift.
 * Aggregates ask_telemetry over a window and reports the rate of low-quality
 * answers, exiting non-zero when a rate crosses its threshold so it can run as a
 * cron / alert. Catches systemic degradation (model swap, corpus drift,
 * regression) that the per-answer guards can't see.
 *
 *   HEALTH_WINDOW_HOURS=24 dotenvx run -f .env.local -- bun scripts/health.ts
 *
 * Needs DATABASE_URL only (no LLM).
 */

import { createClient } from "@agenticmind/shared/database/client"
import { askHealthSince } from "@agenticmind/shared/database/query/knowledge/ask-telemetry"
import { summarizeAskHealth } from "@agenticmind/shared/lib/eval/health"
import { databaseSettings } from "@agenticmind/shared/settings/database-settings"

const hours = Math.max(1, Number.parseInt(process.env.HEALTH_WINDOW_HOURS ?? "", 10) || 24)
const since = new Date(Date.now() - hours * 60 * 60 * 1000)
const db = createClient(databaseSettings.DATABASE_URL)

const rows = await askHealthSince({ tx: db, since })
if (rows.isErr()) {
  console.error(`health query failed: ${rows.error.message}`)
  process.exit(2)
}
const summary = summarizeAskHealth(rows.value)

console.log(`\nfleet health — last ${hours}h (${summary.total} answers)\n${"=".repeat(48)}`)
for (const [status, n] of Object.entries(summary.byStatus).toSorted((a, b) => b[1] - a[1])) {
  const label = status === "__null__" ? "(no status)" : status
  console.log(`  ${label.padEnd(14)} ${String(n).padStart(6)}  ${((summary.rate[status] ?? 0) * 100).toFixed(1)}%`)
}
if (summary.concerns.length === 0) {
  console.log("\nOK — no quality-drift concerns")
  process.exit(0)
}
console.log("\nCONCERNS:")
for (const c of summary.concerns) {
  console.log(`  ⚠ ${c}`)
}
process.exit(1)
