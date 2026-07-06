/**
 * External tool-use audit repo — append-only. Mirrors the guard-event log: a
 * single fast INSERT so the ingestion endpoint can accept-and-return without
 * holding the calling agent's hook. Stores hashes, never raw payloads.
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { ToolAuditEventInsert } from "@agenticmind/shared/database/schema"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { toolAuditEvents } from "@agenticmind/shared/database/schema"
import { ResultAsync } from "neverthrow"

export const recordToolAuditEvent = (props: { tx: Transaction; event: ToolAuditEventInsert }) =>
  ResultAsync.fromPromise(
    props.tx.insert(toolAuditEvents).values(props.event).returning({ id: toolAuditEvents.id }),
    mapDatabaseError,
  )
