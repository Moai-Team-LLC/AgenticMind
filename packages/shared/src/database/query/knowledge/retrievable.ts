/**
 * What retrieval may see (contract 1.11.0). A material ingested without a source
 * is always visible; a source revision's material is visible only while it is
 * its source's current revision — a superseded or still-indexing revision never
 * mixes into an answer — and while the source is neither retracted nor marked
 * unavailable. Every retrieval query over passages or cards (vector,
 * BM25, structured) applies this one predicate, counts included, so the rule
 * lives in one place.
 */

import type { AnyColumn, SQL } from "drizzle-orm"

import { sql } from "drizzle-orm"

/** True for materials retrieval may return; `materialId` is the row's material column. */
export const retrievableMaterial = (materialId: AnyColumn | SQL): SQL =>
  sql`not exists (
    select 1 from source_revisions r
    join knowledge_sources s on s.id = r.source_id
    where r.material_id = ${materialId}
      and (
        s.current_revision_id is distinct from r.id
        or s.tombstoned_at is not null
        or not s.available
      )
  )`
