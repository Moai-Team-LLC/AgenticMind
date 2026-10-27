# AgenticMind MCP Tool Contract

The stable, versioned surface that agents and products build on. The contract is
the set of MCP **tool names**, their **input schemas**, and the **scopes** they
require. It is surfaced to clients as `serverInfo.version` and guarded in CI by a
snapshot test (`packages/shared/src/lib/knowledge/mcp-contract.test.ts`).

**Current version: `1.11.0`** (see `MCP_CONTRACT_VERSION` in
`packages/shared/src/lib/knowledge/mcp-tools.ts`).

## Tools

| Tool | Scope | Required input | Optional input |
| --- | --- | --- | --- |
| `kl_search` | `knowledge:read` | `q` | `queries`, `limit`, `tokenBudget`, `mode`, `sourceTypes`, `period` |
| `kl_ask_global` | `knowledge:read` | `question` | `intent`, `facts`, `mode`, `sourceTypes`, `period` |
| `kl_get_material` | `knowledge:read` | `id` | — |
| `kl_graph_neighbors` | `knowledge:read` | `materialId` | `limit` |
| `kl_signal` | `knowledge:signal` | `askId`, `signal` | `strength`, `note` |
| `kl_ingest` | `knowledge:write` | `title`, `text` | `language`, `lifecycle`, `trustTier`, `source`, `async` |
| `kl_compile_skill` | `knowledge:write` | `target` | `name`, `query`, `limit`, `version` |
| `kl_forget` | `knowledge:admin` | `id` | `sourceType`, `connectionId`, `reason` |
| `kl_upsert_source` | `knowledge:write` | `source`, `revision` | `expectedRevisionId`, `allowResurrect` |
| `kl_get_ingestion_status` | `knowledge:write` | `jobId` | — |
| `kl_read_source` | `knowledge:read` | `sourceId` | `revisionId`, `range`, `offset`, `maxChars` |
| `kl_set_source_availability` | `knowledge:write` | `sourceType`, `externalId`, `available`, `reason` | `connectionId` |
| `mem_recall` | `memory:read` | — | `subject`, `query`, `asOf`, `includeShared`, `limit` |
| `mem_write` | `memory:write` | `subject`, `predicate`, `object` | `confidence`, `embed` |
| `mem_forget` | `memory:admin` | `id` | — |
| `hitl_request` | `hitl:request` | `question` | `kind`, `requestId`, `context`, `expiresInSeconds` |
| `hitl_respond` | `hitl:respond` | `id`, `answer` | — |
| `hitl_get` | `hitl:request` | `id` | — |

`kl_graph_neighbors` is exposed only when GraphRAG is enabled
(`KNOWLEDGE_GRAPHRAG_ENABLED=true`). All write/signal tools assert their scope in
code (fail-closed); `kl_forget` requires the elevated `knowledge:admin` (strictly
above `knowledge:write`) and `mem_forget` the elevated `memory:admin` (above
`memory:write`); read tools require `knowledge:read` at the endpoint. `hitl_respond`
needs `hitl:respond`, a human-facing scope the requesting agent's own token should not
carry. The non-MCP `POST /hooks/audit` endpoint requires `audit:write`.

Every input collection is bounded (array `maxItems`, map `maxProperties`), and the
request body and per-call element count can be capped — see
[configuration knobs](docs/knobs.md#mcp-input-limits).

## Sources and revisions (1.11.0)

Contract 1.11.0 adds sources: a thing at a provider — a meeting, a document, a
chat thread, a file in a repository — that is delivered again and again and
changes over time. Every 1.11.0 field is optional and has no default, so a call
written for 1.10 behaves exactly as before. The full shapes, including outputs,
are frozen in `packages/shared/src/lib/knowledge/source-contract.ts` and its JSON
Schema snapshot (`__contract__/source-tools.schema.json`).

> **Being implemented.** Until each part ships, the server does not list the four
> new tools and refuses a call that sets a new field with
> `<tool>: '<field>' is in contract 1.11.0 but not supported by this server yet`
> — it never accepts a field only to ignore it. A release cannot ship with any of
> them pending (`contract-pending.test.ts`).

### Identity and revisions

- A source is identified within the tenant by `connectionId` (the integration
  instance; omitted = `default`) + `sourceType` (lower-case, e.g. `meeting`,
  `repo_file`) + `externalId` (the provider's id). Equal content under two
  identities stays two sources: authorship and access are never merged by hash.
- Each changed delivery becomes a **revision**. The server computes `contentHash`
  (sha256 of the normalized content); the caller does not supply it.
- A source has at most one **current** revision. A new revision becomes current
  only once its passages are searchable (`text_ready`); until then the previous
  one keeps answering. Each switch increments the tenant's corpus revision,
  reported by `kl_ask_global` as `corpusRevision`.
- The principal that creates a source owns it. Another writer may not update or
  hide it; `knowledge:admin` may.
- Materials ingested without a source stay as they are: no source is assigned to
  them after the fact, and they count as `canonical` and always current.

### `kl_upsert_source`

`source` carries the identity plus `title`, `sourceUrl`, `knowledgeType`
(default `canonical`), `language`, `visibility` and `recipients`. `revision`
carries exactly one of `text` (≤ 200 000 characters) or `segments` (≤ 5 000
utterances `{speaker, speakerId, text, startMs, endMs}`, ≤ 200 000 characters in
total; the array order is the segment index), plus `externalVersion` (the
provider's ordering), `occurredAt` (when the event happened), `provenance`
(`repo`, `path`, `commitSha`, `ref`, `environment`) and `warnings` (known limits
of this content, e.g. "no timecodes", shown wherever it is cited).

The call answers one `outcome`, checked in this order:

| `outcome` | When | Fields |
| --- | --- | --- |
| `retracted` | the source was retracted; nothing is stored (unless `allowResurrect`, which needs `knowledge:admin`) | `sourceId` |
| `conflict` | `expectedRevisionId` is set and is not the current revision (`null` expects no current revision) | `sourceId`, `currentRevisionId` |
| `unchanged` | the content hash equals the current revision, or a revision still being indexed | `sourceId`, `revisionId`, `jobId` (null when indexed), `contentHash` |
| `stale` | `externalVersion` is older than one already received | `sourceId`, `currentRevisionId` |
| `accepted` | a new revision was stored and queued for indexing | `sourceId`, `revisionId`, `jobId`, `contentHash`, `created` |

The current pointer only moves forward: a job whose revision is older than the
source's current revision when its passages are ready does not take it over; it
ends `superseded` (indexed and kept for history, no cards built).

**Visibility.** `workspace` (everyone in the tenant) is the only value accepted
until per-document access control ships; `restricted` (owner, listed principals
and `group:<name>` groups) and `personal` (owner and listed principals only;
groups grant nothing, admins have no implicit access) are reserved and refused
with an explicit error until then. Visibility is fixed when a source is created:
a later upsert with a different value is refused. Changing it is a separate
operation, not part of this contract.

### Background indexing — `kl_get_ingestion_status`

`kl_upsert_source`, and `kl_ingest` with `source` or `async: true`, return a
`jobId` at once; indexing runs in a durable job outside the request.
`kl_get_ingestion_status({ jobId })` answers `{ found: false }` for an unknown job
or another writer's job (unless the caller has `knowledge:admin`), otherwise:

| `status` | Meaning |
| --- | --- |
| `queued` | stored, waiting for a worker |
| `indexing` | passages and embeddings in progress |
| `text_ready` | passages are searchable; cards are still being built (with `error` set, a card step failed and will be retried) |
| `ready` | done |
| `retry_wait` | a retryable failure before the passages exist; another attempt is scheduled |
| `failed` | attempts exhausted or a permanent error; `error` says why |
| `superseded` | finished after a newer revision of the source was accepted |
| `retracted` | the source was retracted while the job ran |

`coverage` reports card extraction over the whole text (`processedChars`,
`totalChars`, `windows`, `failedWindows`); `error` is `{ code, message }` with a
safe message, never a stack trace. A job is retried with exponential backoff and
jitter up to 5 attempts; a job that fails after `text_ready` keeps its passages
searchable. A repeated `async` delivery of the same ingest (same title, text,
language and trust fields) answers the existing job, and re-queues it if it had
failed. Jobs are run by the worker process (`apps/worker`); a deployment without
it keeps `async` ingests queued.

### `kl_read_source`

Reads the stored content of the current revision, or of `revisionId` (e.g. the
one an old citation names) while it is still stored. A dialogue revision is read
by `range` (`fromSegment`..`toSegment`, inclusive), a text revision by `offset`;
both are capped by `maxChars` (default 20 000, at most 100 000) and page with
`nextOffset` / `truncated` — the next character offset for text, the next
segment index for a dialogue (at least one segment is always returned). The result carries `contentHash`, so a quote can be
checked against the revision it came from. An unknown, retracted, unavailable or
not permitted source all answer `{ found: false }`.

### Retraction — `kl_forget`

`kl_forget({ id })` with a material UUID deletes that material as before. To
retract a source, pass its source UUID as `id`, or pass `sourceType` (+
`connectionId`) with the external ID as `id`; `reason` goes to the audit trail. A
retracted source leaves search, answers, reads and counts at once; its revisions,
passages, cards, graph mentions and cached answers are purged by a background job
within 24 hours (`purgeJobId`). Delivering the same source again answers
`retracted` and does not bring it back. A material that belongs to a source
revision is not forgotten on its own: retract the source.

### `kl_set_source_availability`

For content that disappeared at the provider (a file removed from a repository)
but must not be erased: `available: false` keeps the source and leaves it out of
search (every mode), answers, reads and counts; `available: true` brings it back,
and so does an upsert that stores a new revision (an `unchanged` upsert does not).
Repeating the current state answers `unchanged`. The source's owner with
`knowledge:write`, or `knowledge:admin`, may call it; any other caller, an unknown
source and a retracted one all answer `not_found`.

### Retrieval modes and knowledge types

Every source has a `knowledgeType`: `canonical` (authoritative — approved
decisions, maintained documentation), `evidence` (a record of what was said or
observed; saying it does not make it true) or `inference` (produced by a model).
Cards extracted from a source are typed too: a verbatim quote from evidence is
`evidence`, a model's restatement is `inference`.

| `mode` | Revisions | Knowledge types | Lifecycle |
| --- | --- | --- | --- |
| omitted | current | all, as before 1.11 | as before (stale sources down-weighted) |
| `current` | current | `canonical` only | `active` only |
| `research` | current | all, each labelled | all, labelled |
| `history` | current and superseded (`isCurrent`) | all, each labelled | all, labelled |

`sourceTypes` keeps only sources of those types (materials without a source never
match). `period` (`from`, `to`) filters on a revision's `occurredAt`, falling back
to when it was captured. The filters apply to passages, cards and graph context
alike, before ranking. Search hits and citations gain the source fields
`sourceId`, `revisionId`, `sourceType`, `isCurrent`, `knowledgeType`,
`occurredAt`, `sourceUrl`, `segmentRange`, `speaker`, `startMs`, `endMs`,
`provenance` and `warnings` (null for a material without a source).

### `kl_ingest` with `source` or `async`

`source` (`sourceType`, `externalId`, `connectionId`, `sourceUrl`,
`knowledgeType`) makes an ingest idempotent: it runs the `kl_upsert_source` path
with the text as a revision and answers that envelope plus `materialId`.
`async: true` returns at once with `materialId`, `jobId` and `status: "queued"`.
Without either, `kl_ingest` works as before; its result gains `status` and
`jobId`. It answers within the request's time cap: a step that would run past it
(typically card extraction of a long text) is handed to a background job and the
result says `text_ready` (or `queued`) with that `jobId` — never an empty
response.

## Versioning policy (SemVer)

The contract version is independent of the package/release version.

- **PATCH** (`x.y.Z`) — wording-only changes to a tool description; no shape change.
- **MINOR** (`x.Y.0`) — **additive, backward-compatible**: a new tool, or a new
  **optional** input field. Existing clients keep working.
- **MAJOR** (`X.0.0`) — **breaking**: a tool removed or renamed, an input field
  removed or renamed, or a field becoming **required**. Requires a deprecation
  notice (see below).

Any change to the tool set or an input schema must bump `MCP_CONTRACT_VERSION` in
the same PR and update the snapshot test — otherwise the contract test fails. This
makes every contract change deliberate and reviewed.

## Deprecation

Breaking a tool or field follows a two-step path:

1. Mark it deprecated in the tool description and in this file, ship the
   replacement alongside it (MINOR bump).
2. Remove it no earlier than the next MAJOR, after a deprecation window.

Never remove or repurpose a tool/field silently within a MAJOR line.

## Stability guarantee

Within a MAJOR line, a product that pins `serverInfo.version` to `1.x` can rely on:

- every tool listed above remaining present with the same name and scope,
- every required input staying required and every optional input staying optional,
- no input field changing type.

New optional fields and new tools may appear (MINOR) — clients should ignore
unknown fields and tools they don't use.

## Answer envelope (output)

The contract above freezes tool **inputs** (names, fields, required, scopes). Tool
**outputs** are additive-only and not version-gated: new fields may be added to a
result envelope at any time, and clients must ignore unknown ones. For example,
`kl_ask_global` answers carry a `status` to gate on — `supported`, `partial`,
`unsupported`, `conflicted` or `needs_review` — and the Tier-A faithfulness signals
behind it — `groundedness` (0..1 fraction of claim-sentences with a resolving
citation), `unsupportedClaims`, and `abstained` — alongside `citations`; and `mem_recall` annotates beliefs with
`contested` + `effectiveConfidence`. These are advisory: an agent may gate on them,
but their presence never breaks a client that ignores them.

## MCP registry

AgenticMind is self-hosted, so no registry manifest is published (the former
`server.json` was dropped). Clients discover the tool set from the server itself
(`tools/list`) and pin the contract through `serverInfo.version`.
