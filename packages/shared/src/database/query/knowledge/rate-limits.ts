/**
 * Fixed-window rate limiter on Postgres — one atomic upsert per call, no Redis.
 * A row's window resets when it's older than `windowSeconds`; otherwise the
 * counter increments. `allowed` is false once the count exceeds `limit`.
 */

import type { Transaction } from "@agenticmind/shared/database/client"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export const checkRateLimit = (props: {
  tx: Transaction
  key: string
  limit: number
  windowSeconds: number
}): ResultAsync<{ allowed: boolean; count: number }, ReturnType<typeof mapDatabaseError>> =>
  ResultAsync.fromPromise(
    (async () => {
      const res = await props.tx.execute(sql`
        INSERT INTO rate_limits (key, window_start, count)
        VALUES (${props.key}, now(), 1)
        ON CONFLICT (key) DO UPDATE SET
          count = CASE
            WHEN rate_limits.window_start < now() - make_interval(secs => ${props.windowSeconds})
            THEN 1 ELSE rate_limits.count + 1 END,
          window_start = CASE
            WHEN rate_limits.window_start < now() - make_interval(secs => ${props.windowSeconds})
            THEN now() ELSE rate_limits.window_start END
        RETURNING count`)
      const row = res.rows[0] as { count: number } | undefined
      const count = row?.count ?? 0
      return { allowed: count <= props.limit, count }
    })(),
    mapDatabaseError,
  )
