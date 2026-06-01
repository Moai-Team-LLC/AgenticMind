/**
 * Security audit repo — append-only guard event log. Stores hashes, never the
 * offending text (the RedactionEvent contract).
 */

import type { Transaction } from "@agenticmind/shared/database/client"
import type { GuardEventInsert } from "@agenticmind/shared/database/schema"

import { mapDatabaseError } from "@agenticmind/shared/database/database-error"
import { guardEvents } from "@agenticmind/shared/database/schema"
import { ResultAsync } from "neverthrow"

export const recordGuardEvent = (props: { tx: Transaction; event: GuardEventInsert }) =>
  ResultAsync.fromPromise(
    props.tx.insert(guardEvents).values(props.event).returning({ id: guardEvents.id }),
    mapDatabaseError,
  )
