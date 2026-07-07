/**
 * Continuous-assurance run repo (FR-10). Append a completed sweep and read the prior run for a
 * target — the two operations the scheduled drift worker needs. Snapshot-only, insert + read.
 */
import type { Transaction } from "@agenticmind/shared/database/client"
import type { AssuranceRunInsert, AssuranceRunSelect } from "@agenticmind/shared/database/schema"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { assuranceRuns } from "@agenticmind/shared/database/schema"
import { desc, eq } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

/** Persist a completed assurance run. */
export const recordAssuranceRun = (props: { tx: Transaction; run: AssuranceRunInsert }) =>
  ResultAsync.fromPromise(
    props.tx.insert(assuranceRuns).values(props.run).returning({ id: assuranceRuns.id }),
    mapDatabaseError,
  )

/**
 * The most recent run for a target — the drift baseline. Call it BEFORE recording the current run,
 * so the latest stored row is the prior one. Returns null on the first-ever sweep of a target.
 */
export const latestAssuranceRun = (props: { tx: Transaction; target: string }) =>
  ResultAsync.fromPromise(
    props.tx
      .select()
      .from(assuranceRuns)
      .where(eq(assuranceRuns.target, props.target))
      .orderBy(desc(assuranceRuns.createdAt))
      .limit(1),
    mapDatabaseError,
  ).map((rows): AssuranceRunSelect | null => rows[0] ?? null)
