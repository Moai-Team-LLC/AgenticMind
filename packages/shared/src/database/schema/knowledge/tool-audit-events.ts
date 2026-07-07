import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * External tool-use audit log — one row per event pushed in from an outside
 * agent runtime (e.g. a Claude Code hook HTTP POST). This is the ingestion
 * target for the Agent Assurance evidence story: a provenance-complete record
 * that a given tool call / hook fired, by whom, in which session, WITHOUT the
 * tool inputs/outputs leaking into the store.
 *
 * Follows the `guard_events` hash-not-text contract: `payloadHash` is the
 * sha256 of the raw event; only safe structural fields survive in columns and
 * in the curated `metadata` blob. Never write raw tool_input / tool_response.
 *
 * Unlike `ask_feedback.signal`, `event_kind` is intentionally NOT a closed
 * CHECK list — the Claude Code hook-event vocabulary evolves across CLI
 * versions, and rejecting an unknown event would silently drop audit evidence
 * (fail-open on the wrong side). The producer defines the vocabulary; we record.
 */
const toolAuditEvents = pgTable(
  "tool_audit_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Producer of the event, e.g. "claude-code-hook". */
    source: text("source").notNull(),
    /** The hook/event name, e.g. "PostToolUse", "PermissionRequest", "ConfigChange". */
    eventKind: text("event_kind").notNull(),
    /** The authenticated principal that submitted the event, if known. */
    actorUuid: text("actor_uuid"),
    /** The producer-side session id (Claude Code session_id), if any. */
    sessionId: text("session_id"),
    /** The tool the event concerns (tool_name), if any. */
    tool: text("tool"),
    /** accept | reject | deny | allow | ask — the recorded decision, if any. */
    decision: text("decision"),
    /** Sha256 of the raw event payload — never the raw text. */
    payloadHash: text("payload_hash"),
    /** Curated, non-sensitive structural fields (cwd, permission_mode, flags). */
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (table) => [
    index("tool_audit_events_source_time_idx").on(table.source, table.createdAt.desc()),
    index("tool_audit_events_session_time_idx").on(table.sessionId, table.createdAt.desc()),
    index("tool_audit_events_actor_time_idx").on(table.actorUuid, table.createdAt.desc()),
    index("tool_audit_events_created_at_idx").on(table.createdAt.desc()),
  ],
)

type ToolAuditEventInsert = typeof toolAuditEvents.$inferInsert
type ToolAuditEventSelect = typeof toolAuditEvents.$inferSelect

export { toolAuditEvents, type ToolAuditEventInsert, type ToolAuditEventSelect }
