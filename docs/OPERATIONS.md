# Operations & Runbook

Ops guide for self-hosting AgenticMind — the headless MCP knowledge & memory
server. AgenticMind runs on **Postgres + pgvector alone**: vectors, full-text,
the knowledge graph (recursive CTE), and the durable background queue all live
in one datastore. There is **no Redis, no broker, no external queue** to operate.

Two processes make up a deployment:

- **`apps/server`** — the stateless MCP host (streamable HTTP, bearer-auth).
- **`apps/worker`** — a single background process that runs the daily Tier-4
  compounding sweep (`apps/worker/src/index.ts`).

All configuration is environment-driven; see `.env.example` for the full set.

---

## 1. Durability guarantee

This section maps to the Agentic Product Standard, **Layer 5 / Definition-of-Done
#7** (pause / resume / retry across a killed process). Read it honestly before
relying on it.

### What AgenticMind guarantees

AgenticMind is **not** a Temporal-style replayable workflow engine. There is no
event log, no deterministic replay, no step-level checkpointing. Instead,
crash-safety for the one durable background job — the Tier-4 compounding sweep —
is achieved by three concrete mechanisms:

1. **Advisory lock prevents double-runs.**
   The scheduler in `apps/worker/src/jobs/knowledge-feedback/worker.ts` calls
   `pg_try_advisory_lock(4242042)` before each sweep. Only the instance that wins
   the lock runs; every other replica logs `sweep lock held elsewhere — skipping`
   and no-ops. The lock is released in a `finally` block after the sweep, then the
   timer reschedules for the next 04:00 UTC slot. This makes running N worker
   replicas safe — at most one sweep executes at a time.

2. **Idempotent + 7-day re-scan window self-heals after a restart.**
   The handler (`apps/worker/src/jobs/knowledge-feedback/handler.ts`) re-scans the
   **last 7 days of asks** on every run (`LOOKBACK_MS = 7 days`). The cluster
   builder only touches un-clustered rows and `AddMember` is idempotent, so a
   re-scan is cheap and self-healing: if a process is killed mid-sweep, the next
   scheduled run reconsiders the same window and finishes the work. No state is
   lost, and no row is double-processed.

3. **Best-effort steps never abort the sweep.**
   The sweep runs three steps — feedback-cluster builder, cluster promoter
   (LLM-judge → `resolution` cards), and belief consolidation. Each is wrapped in
   a Result `match`; a failure in one step is logged and the others still run. A
   crash or transient error simply means the next daily run retries.

4. **Postgres is the single durable store.**
   There is no in-memory queue to lose. Everything the sweep reads and writes is a
   Postgres row. If the worker dies, durability is whatever Postgres has committed
   — back that up (Section 2) and the system is recoverable.

### What AgenticMind does NOT guarantee — the boundary

> AgenticMind does **not** provide durable execution for the *consuming agent's*
> own loop.

If your agent is mid-task when it crashes, AgenticMind will not pause/resume that
agent's reasoning loop, tool calls, or partial outputs. Per the Agentic Product
Standard, **the product must bring its own durable execution** for its agent loop
(checkpointing, a workflow engine such as Temporal/Restate, or equivalent).
AgenticMind's durability scope is limited to:

- its **own** background compounding sweep (self-healing, as above), and
- the **durability of stored knowledge & memory** (committed Postgres rows).

MCP tool calls (`kl_search`, `kl_ask_global`, `kl_ingest`, `mem_write`, …) are
ordinary request/response operations. A killed request is simply retried by the
caller; `kl_ingest` re-ingesting the same text re-chunks/re-embeds it (treat
ingestion idempotency at the source if you need exactly-once).

---

## 2. Backup & restore

All durable state is in Postgres. There is nothing else to back up (blob storage
for raw ingested bytes is optional and external — any S3-compatible provider, see
`S3_*` in `.env.example`).

### Required extensions

The schema depends on three Postgres extensions, created on first init by
`scripts/db-init/00-extensions.sql`:

- `vector` — pgvector, the `vector(1024)` embedding columns.
- `vectorscale` — pgvectorscale, the `USING diskann` ANN indexes.
- `pg_trgm` — trigram (`gin_trgm_ops`) fuzzy-text index.

The bundled `docker-compose.yml` uses `timescale/timescaledb-ha:pg17`, which ships
all three. **Any restore target must have these extensions available**, or the
schema (and the diskann indexes in particular) will not load.

### Backup (self-hosted Docker Postgres)

```bash
# Logical dump (portable, recommended). Container name may differ — check `docker ps`.
docker compose exec db \
  pg_dump -U postgres -d postgres -Fc -f /tmp/agenticmind.dump
docker compose cp db:/tmp/agenticmind.dump ./agenticmind.dump
```

The `pgdata` Docker volume (`pgdata:/home/postgres/pgdata`) is the physical store.
A volume snapshot is a valid full backup, but a logical `pg_dump` is more portable
across PG minor/major versions and is the recommended path.

### Restore

```bash
# Into a fresh DB that already has vector / vectorscale / pg_trgm available.
docker compose cp ./agenticmind.dump db:/tmp/agenticmind.dump
docker compose exec db \
  pg_restore -U postgres -d postgres --clean --if-exists /tmp/agenticmind.dump
```

If you restore into a brand-new instance, ensure the extensions exist first
(`CREATE EXTENSION IF NOT EXISTS vector; … vectorscale; … pg_trgm;`) — the
`scripts/db-init` hook only runs on a first-init empty data directory.

### Managed Postgres (Supabase / Neon / RDS)

Use the provider's snapshot / point-in-time-recovery (PITR) feature as the primary
backup, and keep periodic `pg_dump` logical exports for portability. Confirm the
provider supports pgvector **and** pgvectorscale before adopting it — pgvectorscale
(diskann) is less universally available than pgvector.

---

## 3. Scaling

AgenticMind is designed to scale horizontally on the read path and stay single-
runner on the write/sweep path, with Postgres as the only stateful tier.

### MCP server — stateless, scale horizontally

`apps/server` holds no local state. Run multiple replicas behind a load balancer
and point them all at the same `DATABASE_URL`. Each replica authenticates MCP
bearer tokens independently (HS256, `AUTH_SECRET`) and serves reads
(`kl_search`, `kl_ask_global`, `mem_recall`) and writes (`kl_ingest`,
`mem_write`) directly against Postgres. Scale replicas to match request load; the
bottleneck is Postgres, not the server.

**Client-disconnect resilience.** A client that aborts or times out mid-stream is
handled gracefully: the host detects the benign closed-stream error class
(`isClientDisconnectError`) and logs-and-ignores it at the process level instead
of crashing. One dropped client never affects other in-flight requests. Genuine
faults are not matched, so they remain fatal (and a supervisor restarts the
process).

### Worker — single advisory-locked runner

The worker self-limits to one active sweep via the Postgres advisory lock
(Section 1). You may deploy extra worker replicas for availability — the lock
makes the surplus **safe no-ops** (they wake at 04:00 UTC, fail to acquire the
lock, and skip). There is no benefit to more than one *active* worker; deploy
extras only for failover, not throughput.

### Database — scale the one stateful tier

Postgres is the scaling lever. Options:

- Vertically scale the Postgres instance (CPU/RAM/IOPS) — the simplest win.
- Move to **managed Postgres** (Supabase, Neon, RDS) with pgvector + pgvectorscale.
  Set `DATABASE_URL` to the managed endpoint and **`DATABASE_SSL=true`** (managed
  PG requires TLS; the client in `packages/shared/src/database/client.ts` enables
  SSL only when this is the string `"true"`).
- Tune `DATABASE_POOL_MAX` (default `10`) per server replica so the aggregate
  connection count stays within the database's `max_connections`.
- For heavy read fan-out, add read replicas at the database layer (application-side
  read routing is out of scope for the flagship).

---

## 4. Switching model providers

Both the embedding provider and the chat/synthesis provider are swappable via env
vars — no code changes. See `.env.example` for the canonical, commented set.

### Embeddings (`EMBED_PROVIDER`)

- **`local`** (default) — a zero-key, offline, in-process multilingual model
  (`Xenova/bge-m3`, 1024-dim, `EMBED_POOLING=cls`). First run downloads the model;
  no API key, no network at query time. This is what makes a clean clone work with
  no cloud credentials.

  > **Blocked Hugging Face CDN?** The first-run download pulls the model from
  > `huggingface.co`, which redirects to `cdn-lfs.huggingface.co` /
  > `cas-bridge.xethub.hf.co`. If those are blocked (corporate firewall, region),
  > the download fails. Three options:
  > - **Mirror** — `EMBED_HF_ENDPOINT=https://hf-mirror.com` downloads via the
  >   mirror instead of the blocked CDN.
  > - **Pre-seed a cache** — set `EMBED_CACHE_DIR=/path` on a machine *with*
  >   access, let it download once, copy that directory to the blocked host, and
  >   set the same `EMBED_CACHE_DIR` there (fully offline / air-gapped).
  > - **Sidestep Hugging Face** — use the `openai` provider below pointed at a
  >   local Ollama `bge-m3` (also 1024-dim): `EMBED_PROVIDER=openai`,
  >   `EMBED_BASE_URL=http://localhost:11434/v1`, `EMBED_MODEL=bge-m3`.
- **`openai`** — any hosted OpenAI-compatible endpoint (OpenAI, Ollama, vLLM,
  OpenRouter, …). Set `EMBED_PROVIDER=openai`, `EMBED_BASE_URL`, `EMBED_MODEL`, and
  `EMBED_API_KEY` as needed.

> **Embedding dimension is pinned to 1024.** The schema's vector columns are
> `vector(1024)` (see the baseline migration `drizzle/0000_common_randall_flagg.sql`).
> Any chosen embedding model **must** output 1024-dim vectors or ingestion fails
> fast. Changing the dimension is a **breaking schema change** that requires a full
> re-embed of every existing corpus — see "Re-embedding" below.

### Chat / synthesis (`CHAT_BASE_URL`)

Chat is a single OpenAI-compatible seam used for synthesis, classification, and
extraction. Set `CHAT_API_KEY` and (optionally) `CHAT_BASE_URL`:

- **OpenAI** (default) — set `CHAT_API_KEY`; `CHAT_BASE_URL` defaults to
  `https://api.openai.com/v1`, with model tiers `CHAT_MODEL_SIMPLE` (cheap/fast)
  and `CHAT_MODEL_COMPLEX` (flagship).
- **[AgenticGateway](https://github.com/Moai-Team-LLC/AgenticGateway)** — the
  family's model & cost plane, and the paved road when composing the
  AgenticProduct stack: point `CHAT_BASE_URL` at the gateway (e.g.
  `http://localhost:8787/v1`) with a tenant key as `CHAT_API_KEY`. Every
  synthesis/extraction call then gets fail-closed budgets, eval-measured
  routing, caching, and a hash-not-text evidence trail — without touching this
  repo's config again when providers change.
- **Ollama / vLLM / OpenRouter** — point `CHAT_BASE_URL` at the endpoint (e.g.
  `http://localhost:11434/v1` for Ollama, `https://openrouter.ai/api/v1` for
  OpenRouter) with the matching `CHAT_API_KEY` and model ids. Combined with
  `EMBED_PROVIDER=local`, Ollama runs the whole system fully offline.

Optional cross-encoder rerank is off by default; enable with `RERANK_ENABLED=true`
and set `RERANK_API_KEY` (native Cohere `https://api.cohere.com/v2/rerank` by
default; override `RERANK_BASE_URL` for Voyage / Jina).

### Re-embedding after a model/provider change

The baseline migration (`drizzle/0000_common_randall_flagg.sql`) ships the schema
with `vector(1024)` columns and the full-text config already in place — a fresh
clone needs no dimension upgrade. You only need to re-embed when you **change the
embedding model or provider to one that produces a different vector space** (a new
`EMBED_MODEL`/`EMBED_PROVIDER`, or any model whose vectors are not comparable to the
existing ones). A re-embed script is maintained at **`scripts/reembed.ts`** — run it
after any such change; until the corpus is re-embedded, its vector search results
are not meaningful. (Moving off 1024 dimensions additionally requires altering the
`vector(N)` columns — a breaking schema change.)

---

## 5. Observability

The knowledge pipeline is instrumented with OpenInference spans via
`@opentelemetry/api` — the replayable why-trace. With no provider registered this
instrumentation is a **zero-cost no-op**.

### Enabling traces

Set a single env var:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # OTLP/HTTP
```

When set, `apps/server/src/tracing.ts` registers a `NodeTracerProvider` with a
`BatchSpanProcessor` + OTLP/HTTP exporter (service name `agenticmind-mcp`), and
logs `[OTEL] tracing enabled → <endpoint>`. Spans then flow to any OTLP-compatible
backend — **Phoenix, Langfuse, LangSmith**, or any OTLP collector — with no code
changes on the product side. Unset (or empty) → tracing returns early and stays a
no-op.

### Logs

Both processes log to stdout/stderr in plain text (capture via your container/log
platform):

- **Worker** logs each schedule (`next knowledge-feedback sweep in ~N min`), lock
  acquisition/skip, and per-step counts, e.g.
  `[KNOWLEDGE_FEEDBACK] builder: scanned=… joined=… new=…`,
  `[KNOWLEDGE_FEEDBACK] promoter: promoted=… judged=… skipped=…`,
  `[BELIEF] consolidate: scanned=… consolidated=…`. These counts are the primary
  signal that the daily compounding loop is healthy.
- The bundled Docker Postgres is configured to log all statements
  (`log_statement=all`, `log_min_duration_statement=0`) — useful for local
  debugging, but turn this down in production to avoid log volume and overhead.

### Health signals to watch

- Worker emits a `next … sweep` line on boot and after every run — its absence
  means the scheduler is wedged or the process is down.
- A run that logs the three step-count lines around 04:00 UTC daily indicates a
  healthy sweep.
- `sweep lock held elsewhere — skipping` from extra worker replicas is **expected**
  and benign.

## 6. Debugging a bad answer — where to fix

### First: what counts as a *bad* answer

Before debugging one, define it — otherwise the symptoms below are an arbitrary
list. AgenticMind does **not** promise the answer is *true*: it can only know its
corpus, not the world. It promises three narrower things:

- **faithful** — every claim traces to a resolving citation;
- **honestly labeled** — `status` reflects the real groundedness / conflict /
  staleness of the answer;
- **safe** — no PII, no obeyed injection, no retrieval of retracted
  (`rejected` / `deprecated` / `archived`) knowledge.

So a **bad answer is a breach of *that* promise, not merely "the text was wrong."**
Judge it on two axes — **correctness** (is the claim true/grounded?) and
**calibration** (does the self-reported `status` match reality?):

- **Tier 1 — genuinely bad (contract violated).** A hallucination presented as
  grounded (`status = supported` while claims are uncited); a confidently-wrong
  answer (`supported` but false/ungrounded); an unsafe answer (PII, injection,
  retracted knowledge surfaced); a stale-as-fresh answer (rests on `deprecated`
  sources without the `staleSourcesOnly` / `needs_review` flag).
- **Tier 2 — quality issue, contract intact.** Faithfully cites a wrong or
  low-trust source (the synthesis did its job; the *corpus* is at fault);
  over- or under-abstention; a disagreement flattened to one side without
  `contested`.
- **Tier 3 — NOT bad by contract, even if "wrong."** A wrong answer that honestly
  labels itself `unsupported` / `needs_review` / `conflicted`, or an honest
  abstention on an out-of-corpus query. The promise was kept — the caller was
  warned and can gate on `status`.

The crisp line: **a wrong answer that says `unsupported` kept the promise; a wrong
answer that says `supported` broke it.** Debugging targets Tier 1 first (the label
lied), then Tier 2 (the corpus or a knob is off). Tier 3 is working as designed —
the fix there is in the *caller* (gate on `status`) or the corpus, not the engine.

### The procedure: start from two fields

Every `kl_ask_global` answer carries `status` and `servedBy`. Read those first —
they cut the search space before you look at anything else:

- **`servedBy`** = `cache` → the answer came from the cache, *not* fresh retrieval.
  Look at the cache first (below). `card_synth` → a knowledge card drove it.
  `synth` → fresh retrieval + synthesis.
- **`status`** = `supported` / `partial` / `unsupported` / `conflicted` /
  `needs_review` → tells you *how* the engine already judged its own answer. A wrong
  answer that is already `unsupported`/`needs_review` is a **gating** problem (the
  signal fired, nobody acted on it); a wrong answer marked `supported` is a
  **retrieval or source** problem (the signal didn't fire when it should have).

### Symptom → signal → stage → knob

| Symptom | Read this on the answer | Stage at fault | Fix / knob |
| --- | --- | --- | --- |
| Confident but **wrong fact** | `groundedness` high, citations resolve | retrieval pulled a wrong/low-trust source | check the cited source's `lifecycle`/`trustTier`; deprecate or re-rank it; tune `RETRIEVAL_PARAMS` |
| **Hallucination** (no support) | `citations = 0`, `groundedness = 0`, `status = unsupported`, `abstained = false` | synth over-answered out-of-corpus | set `KNOWLEDGE_ANSWER_POLICY` `minGroundedness` → forces a refusal (see *Abstention posture* in evals) |
| **Cited but not actually supported** | `unsupportedClaims` / `contradictedClaims` non-empty | answer-time faithfulness | turn on `KNOWLEDGE_FAITHFULNESS_TIER_B`; gate on `status` |
| **Stale** answer | `staleSourcesOnly = true`, `status = needs_review`, citation `lifecycle = deprecated` | source lifecycle | mark the current source `active` / the old one `deprecated`; the signal already flags it |
| **One-sided** on a disputed fact | `contested = []` when sources disagree | contested-sources judge off | turn on `KNOWLEDGE_CONTESTED_SOURCES` |
| **Wrong cached** answer | `servedBy = cache` | answer cache (near-but-different hit) | set `KNOWLEDGE_CACHE_ENABLED=false` to isolate; if it disappears, the cache key/threshold is the cause |
| **Right chunk missing** from citations | `servedBy = synth`, `rerankUsed`, citation set | retrieval ordering | turn on `RERANK_ENABLED`; tune `RETRIEVAL_PARAMS` (hybrid weights / topK); verify embeddings |
| **PII** in the answer | scan the answer text | output filter | `KNOWLEDGE_PII_REDACTION` is on by default — confirm it is not set to `false` |
| **Bad promoted card** keeps resurfacing | the card's `status`, its cluster `aggregate_score` | compounding loop | `KNOWLEDGE_DEMOTION_ENABLED` (retracts net-negative cards); check the acceptance evaluator gate |
| **Slow** answer | `phases[]` (per-stage ms), `rerankLatencyMs` | the slowest phase | disable or tune that one stage; everything is timed individually |

### Reproduce one answer end-to-end

The signals above are on the live answer and in the OTLP spans (§5). To replay a
single question and read every stage's signal in one place, re-run it against the
same corpus with tracing on:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  dotenvx run -f .env.local -- bun scripts/eval.ts   # or one EVAL_ONLY bucket
```

Each answer's `status`, `servedBy`, `groundedness`, `phases`, `contested`,
`rerankUsed`, and `graphContextRows` then appear on the span — the same fields the
table keys off. The dozen degrees of freedom collapse to: **read `status` +
`servedBy` → follow the one signal → turn the one knob.**
