# ADR-0001: First non-MCP REST endpoint — /hooks/audit ingestion

> **Placement:** target repo `AgenticMind` has no `docs/adr/` yet — this is its
> first ADR (ADR-0001). Renumber only if the repo already has a sequence when placed.

- **Status:** Proposed
- **Date:** 2026-07-04

## Context

WS2 delivers zero-glue ingestion of Claude Code tool-use events into AgenticMind
as evidence records. Today the AgenticMind server exposes only `/health` and
`/mcp` — every capability is reached through MCP. Accepting an HTTP hook POST
means introducing the **first non-MCP REST endpoint** in the server. That is a
small surface but a real architectural first, and it warrants a recorded decision
(ADOPTION-MATRIX §2: "First non-MCP endpoint = small arch decision (ADR)").

The pieces already exist and make this the best value/effort item in scope: JWT +
API-key auth with scopes; a `guard_events` table that stores hash-not-text as the
schema precedent; `ask_feedback`/`ask_telemetry` as further precedent; an
advisory-lock worker for async writes; and OTel already wired.

Matrix delta **D3** applies: the HTTP-hook *config* schema is documented (`url`,
`headers`, `allowedEnvVars`), but its **runtime semantics — sync/async, timeout,
retry, failure impact — are undocumented**, and no "shared audit service" use case
appears in the docs. So the WS2 property "endpoint failure must not break the
session" is verified **empirically**, not asserted from docs.

## Decision

Introduce `POST /hooks/audit` as the first REST endpoint, with:

- a new **`audit:write`** scope (reuse the existing scope machinery; do not widen
  any existing scope);
- a new **`tool_audit_events`** table for provenance-complete evidence rows;
- an **async queue-and-sweep write path** (the existing advisory-lock worker
  pattern), so the endpoint acknowledges fast and persists out of band;
- **hash-not-text payloads**, matching the `guard_events` precedent — we store
  hashes and metadata, not raw tool arguments.

The "endpoint failure does not break the working session" guarantee is proven by
an E2E test (kill/500 the endpoint mid-session), because D3 leaves it
doc-unbacked.

## Consequences

- Unblocks WS6: the same `tool_audit_events` store receives OTel-derived evidence,
  so there is one evidence store, not two.
- The server now has two ingress shapes (MCP + REST); routing, auth, and docs must
  acknowledge both. This is the deliberate cost of the "first REST endpoint"
  decision — kept minimal by reusing scopes, worker, and hashing conventions.
- Async write path means eventual, not synchronous, evidence visibility; the E2E
  test asserts correct session/tool/timestamp attribution once swept.
- Latency overhead is measured and documented as an exit criterion (brief WS2).
- Revisit trigger: if Claude Code later documents HTTP-hook runtime semantics
  (resolving D3), the empirical failure test can be reduced to a regression check.

## Alternatives considered

- **Route audit through MCP** instead of a REST endpoint — avoids the "first REST
  endpoint" precedent, but hook HTTP POST is the native, zero-glue path per the
  hooks reference; forcing it through MCP would reintroduce the custom glue WS2
  exists to remove. Rejected.
- **Synchronous write path** — simpler, but a slow/failed DB write would then be
  able to stall or break the session, violating the WS2 non-interference property.
  Rejected in favor of queue-and-sweep.
- **Store raw tool text** — richer evidence, but breaks the hash-not-text
  precedent and widens the PII/secret surface. Rejected.
