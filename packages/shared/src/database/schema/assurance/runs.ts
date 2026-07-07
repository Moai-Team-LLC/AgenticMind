import { sql } from "drizzle-orm"
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Continuous-assurance run history (FR-10). One row per scheduled assurance sweep: the
 * control-status snapshot (`[{ controlId, status }]`) that the next run diffs against to detect
 * drift, plus the alert flag for a run that regressed a control green→red.
 *
 * Operational/system data produced by a background sweep (keyed by the scanned `target`), not
 * tenant knowledge — so, like `tool_audit_events`, it carries no tenant column. Snapshot-only: no
 * raw evidence text lands here (hash-not-text); the full auditor bundle is derived on demand.
 */
const assuranceRuns = pgTable(
  "assurance_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** The scanned target (agent manifest id / name). */
    target: text("target").notNull(),
    /** Control-status snapshot `[{ controlId, status }]` — exactly what `diffSnapshots` compares. */
    snapshot: jsonb("snapshot").notNull(),
    /** True if this run regressed a control green→red vs. the prior run (the alert condition). */
    criticalDrift: boolean("critical_drift").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [index("assurance_runs_target_time_idx").on(table.target, table.createdAt.desc())],
)

type AssuranceRunInsert = typeof assuranceRuns.$inferInsert
type AssuranceRunSelect = typeof assuranceRuns.$inferSelect

export { assuranceRuns, type AssuranceRunInsert, type AssuranceRunSelect }
