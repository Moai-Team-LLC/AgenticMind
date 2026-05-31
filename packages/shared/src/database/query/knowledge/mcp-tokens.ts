/**
 * MCP token registry repo. Issued typ="mcp" JWTs are recorded here so the
 * /api/mcp route can verify them and revoke them. checkMcpToken fails CLOSED:
 * an unknown jti is inactive (mirrors the Go RevocationChecker contract).
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { McpTokenSelect } from "@agenticmind/shared/database/schema"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { mcpTokens } from "@agenticmind/shared/database/schema"
import { desc, eq, sql } from "drizzle-orm"
import { ResultAsync } from "neverthrow"

export type McpTokenCheck =
  | { active: true; userUuid: string; actorType: string; scopes: string[] }
  | { active: false; reason: "unknown" | "revoked" | "expired" }

/** Records a freshly-minted token (status active). */
export const issueMcpToken = (props: {
  tx: Transaction
  jti: string
  userUuid: string
  label: string
  expiresAt: Date
  /** Principal kind (default "agent"). */
  actorType?: string
  /** Granted scopes (default ["knowledge:read"]). */
  scopes?: string[]
}) =>
  ResultAsync.fromPromise(
    props.tx
      .insert(mcpTokens)
      .values({
        jti: props.jti,
        userUuid: props.userUuid,
        label: props.label,
        expiresAt: props.expiresAt,
        ...(props.actorType !== undefined ? { actorType: props.actorType } : {}),
        ...(props.scopes !== undefined ? { scopes: props.scopes } : {}),
      })
      .returning({ jti: mcpTokens.jti }),
    mapDatabaseError,
  )

/** Fail-closed validity check for a presented jti. */
export const checkMcpToken = (props: { tx: Transaction; jti: string }) =>
  ResultAsync.fromPromise(
    props.tx.select().from(mcpTokens).where(eq(mcpTokens.jti, props.jti)).limit(1),
    mapDatabaseError,
  ).map((rows): McpTokenCheck => {
    const row = rows[0]
    if (row === undefined) {
      return { active: false, reason: "unknown" }
    }
    if (row.revokedAt !== null) {
      return { active: false, reason: "revoked" }
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      return { active: false, reason: "expired" }
    }
    return {
      active: true,
      userUuid: row.userUuid,
      actorType: row.actorType,
      scopes: row.scopes,
    }
  })

/** Flips a token to revoked (idempotent). */
export const revokeMcpToken = (props: { tx: Transaction; jti: string; reason?: string }) =>
  ResultAsync.fromPromise(
    props.tx
      .update(mcpTokens)
      .set({
        revokedAt: sql`now()`,
        revokedReason: props.reason !== undefined && props.reason !== "" ? props.reason : null,
      })
      .where(eq(mcpTokens.jti, props.jti))
      .returning({ jti: mcpTokens.jti }),
    mapDatabaseError,
  )

/** Lists a user's tokens (or all), newest first — for the admin UI. */
export const listMcpTokens = (props: { tx: Transaction; userUuid?: string; limit?: number }) => {
  const limit =
    props.limit !== undefined && props.limit > 0 && props.limit <= 200 ? props.limit : 50
  return ResultAsync.fromPromise(
    (async (): Promise<McpTokenSelect[]> => {
      const base = props.tx.select().from(mcpTokens)
      const rows =
        props.userUuid !== undefined
          ? await base
              .where(eq(mcpTokens.userUuid, props.userUuid))
              .orderBy(desc(mcpTokens.createdAt))
              .limit(limit)
          : await base.orderBy(desc(mcpTokens.createdAt)).limit(limit)
      return rows
    })(),
    mapDatabaseError,
  )
}
