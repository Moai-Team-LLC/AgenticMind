/**
 * What retrieval may see (contract 1.11.0). A material ingested without a source
 * is always visible; a source revision's material is visible only while it is
 * its source's current revision — a superseded or still-indexing revision never
 * mixes into an answer — and while the source is neither retracted nor marked
 * unavailable. Every retrieval query over passages or cards (vector, BM25,
 * structured) applies this one predicate, counts included, so the rule lives in
 * one place; a retrieval scope (mode, source types, period) narrows it there too.
 */

import type { SearchMode } from "@agenticmind/shared/lib/knowledge/source-contract"
import type { AnyColumn, SQL } from "drizzle-orm"

import { sql } from "drizzle-orm"

export type RetrievalScope = {
  /** Omitted = the pre-1.11 behaviour: current revisions, every knowledge type. */
  mode?: SearchMode
  sourceTypes?: readonly string[]
  period?: { from?: string; to?: string }
}

/** True for materials retrieval may return under `scope`; `materialId` is the row's material column. */
export const retrievableMaterial = (
  materialId: AnyColumn | SQL,
  scope: RetrievalScope = {},
): SQL => {
  const conditions: SQL[] = [
    // History also sees superseded revisions; nothing ever sees a retracted or unavailable source.
    scope.mode === "history"
      ? sql`not exists (
          select 1 from source_revisions r
          join knowledge_sources s on s.id = r.source_id
          where r.material_id = ${materialId}
            and (s.tombstoned_at is not null or not s.available)
        )`
      : sql`not exists (
          select 1 from source_revisions r
          join knowledge_sources s on s.id = r.source_id
          where r.material_id = ${materialId}
            and (
              s.current_revision_id is distinct from r.id
              or s.tombstoned_at is not null
              or not s.available
            )
        )`,
  ]
  if (scope.mode === "current") {
    // Canonical knowledge only (a material without a source counts as canonical), active lifecycle.
    conditions.push(sql`not exists (
      select 1 from source_revisions r
      join knowledge_sources s on s.id = r.source_id
      where r.material_id = ${materialId} and s.knowledge_type <> 'canonical'
    )`)
    conditions.push(
      sql`exists (select 1 from materials m where m.id = ${materialId} and m.lifecycle = 'active')`,
    )
  }
  if (scope.sourceTypes !== undefined && scope.sourceTypes.length > 0) {
    const types = sql.join(
      scope.sourceTypes.map((t) => sql`${t}`),
      sql`, `,
    )
    conditions.push(sql`exists (
      select 1 from source_revisions r
      join knowledge_sources s on s.id = r.source_id
      where r.material_id = ${materialId} and s.source_type in (${types})
    )`)
  }
  const from = scope.period?.from
  const to = scope.period?.to
  if (from !== undefined || to !== undefined) {
    // When the recorded event happened; else when it was captured.
    const when = sql`(
      select coalesce(r.occurred_at, r.captured_at, m.created_at)
      from materials m left join source_revisions r on r.material_id = m.id
      where m.id = ${materialId}
      limit 1
    )`
    if (from !== undefined) {
      conditions.push(sql`${when} >= ${from}::timestamptz`)
    }
    if (to !== undefined) {
      conditions.push(sql`${when} <= ${to}::timestamptz`)
    }
  }
  return sql.join(conditions, sql` and `)
}

/** Whether `scope` narrows retrieval at all (the answer cache does not key on it). */
export const isScoped = (scope?: RetrievalScope): boolean =>
  scope !== undefined &&
  (scope.mode !== undefined ||
    (scope.sourceTypes !== undefined && scope.sourceTypes.length > 0) ||
    scope.period?.from !== undefined ||
    scope.period?.to !== undefined)
