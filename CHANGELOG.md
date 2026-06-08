# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] — 2026-06-08

The **auditable-contract** release: the engine's faithfulness signals become a
single verdict an agent can gate on and a policy an operator can enforce, source
trust is modelled and made visible, and every new signal is provable by the eval
harness. Still drop-in to deploy — DB + `OPENAI_KEY`, no new runtime stack; every
new behaviour is off/neutral by default.

### Added

- **Answer faithfulness, two tiers.** Tier-A structural groundedness +
  `unsupportedClaims` + honest `abstained`, computed for free on every answer;
  Tier-B semantic entailment of each cited claim against its snippet
  (`semanticGroundedness`, `contradictedClaims`) behind `KNOWLEDGE_FAITHFULNESS_TIER_B`.
- **A single answer `status`.** `supported | partial | unsupported | conflicted |
  needs_review`, derived from the signals — the one field an agent gates on.
- **Answer policy enforcement.** `KNOWLEDGE_ANSWER_POLICY` (JSON, default unset)
  blocks under-grounded answers and review-gates conflicted / cited-but-unentailed
  ones, with the decision attached to the trace.
- **Contested sources on `kl_ask_global`.** Facts the retrieved sources disagree
  on are surfaced (each side tagged with source + date), not silently resolved —
  behind `KNOWLEDGE_CONTESTED_SOURCES`. Complements `mem_recall`'s `contested`.
- **Source lifecycle + trust tier.** Materials carry a content lifecycle
  (`active | deprecated | superseded | archived`) and a trust tier; retrieval
  down-weights stale/low-trust sources, citations and contested sides expose it,
  an answer resting only on stale sources is flagged (`staleSourcesOnly` →
  `needs_review`), and both are settable at ingest via `kl_ingest`. Migration `0006`.
- **Self-improving read path.** `mem_forget`, corpus-adaptive retrieval tuning,
  and a closed loop that folds net-positively-signalled real queries into the
  tuner's eval set (opt-in `KNOWLEDGE_EVAL_HARVEST`; migration `0005`).
- **Eval discipline.** Citation precision/recall metrics + gold-relevance gates,
  and validated failure-mode buckets for conflicting sources, stale versions, and
  source hierarchy.
- **Multi-tenant hardening.** A cross-tenant RLS leakage eval that blocks CI, and
  a least-privilege app role (`DATABASE_APP_ROLE`, migration `0004`) so RLS holds
  even on an owner connection.
- **Cost controls.** Per-run output ceiling + per-call token usage in the trace.
- **Embeddings.** Optional `dimensions` (`EMBED_SEND_DIMENSIONS`) so OpenAI's
  `text-embedding-3-*` models can serve the schema's 1024 dims.
- **Operations & docs.** A published docs site (MkDocs), security model + MCP
  client cookbook, a config-knobs reference, and supply-chain signing (cosign +
  SBOM + SLSA provenance) on the multi-arch release images.

### Changed

- **MCP tool contract `1.2.0` → `1.8.0`** (all additive — existing clients
  unaffected): `kl_search` gains `queries` + `tokenBudget`; answers gain
  `status`, `contested`, `effectiveConfidence`, `semanticGroundedness`,
  `contradictedClaims`, `staleSourcesOnly`, and citation `lifecycle`/`trustTier`;
  `kl_ingest` gains `lifecycle` + `trustTier`.

### Security

- Synthesis hardened against indirect prompt injection carried in source content.

[0.9.0]: https://github.com/Moai-Team-LLC/AgenticMind/releases/tag/v0.9.0

## [0.8.0] — 2026-06-05

### Added

- **Contested beliefs surfaced on recall.** `mem_recall` now returns a
  `contested` list: any recalled fact where sources disagree (same
  subject+predicate, different objects), each competing variant tagged with its
  source actor and recording date. The agent can flag a dispute instead of
  silently trusting one side.
- **Time-decayed belief confidence.** Each recalled belief carries an
  `effectiveConfidence` — its stored confidence after exponential time-decay
  (90-day half-life). A belief that is not re-asserted loses weight as it ages
  (recency is trust); re-assertion resets it. Prefer it over raw `confidence`
  when deciding how much to trust a fact.
- **Batch + token-budget retrieval.** `kl_search` accepts a batch of `queries`
  fanned out in one round-trip (results merged and deduped by chunk, best score
  wins) and an optional `tokenBudget` to return the best ~N tokens of context
  instead of a fixed passage count.
- **Opt-in multi-tenant isolation.** Every knowledge table gains a `tenant_id`
  column and a Postgres row-level-security policy (migration `0003`); MCP tokens
  carry a tenant and each request runs inside a tenant context, so RLS scopes
  every read and write below the application and the model. Single-tenant
  deployments configure nothing — rows carry the default tenant and it just
  works. (Multi-tenant enforcement requires the app to connect as a
  non-superuser database role, since superusers bypass RLS.)
- **Multi-arch container images.** The release image build now publishes
  `linux/amd64` **and** `linux/arm64`, so `docker pull`/`run` works unchanged on
  Apple Silicon dev machines and arm64 cloud (Graviton/Ampere) without a
  `--platform` flag.
- **Contributor CLA gate and one-command quickstart.** A CLA check guards
  contributions, and a no-clone quickstart script stands the stack up from the
  published images. Engineering deep-dive blog posts document the why-trace,
  Postgres-only, and provenance design choices.

### Changed

- **MCP tool contract bumped 1.2.0 → 1.3.0** (additive — existing clients are
  unaffected): `kl_search` gains optional `queries` and `tokenBudget`;
  `mem_recall` results gain `contested` and `effectiveConfidence`.

[0.8.0]: https://github.com/Moai-Team-LLC/AgenticMind/releases/tag/v0.8.0

## [0.7.0] — 2026-06-04

### Added

- **Optional per-language full-text search.** `kl_ingest` gains an optional
  `language` parameter, and each material records its own `fts_config` (Postgres
  text-search configuration) so language-aware stemming can be applied per
  document — while the corpus default stays the language-neutral `simple` config.
  Migration `0002` adds the `fts_config` column. The MCP tool contract is bumped
  to **1.2.0** (additive — `language` is optional, existing clients unaffected).

### Changed

- **Blob storage is now provider-neutral S3, not DigitalOcean-specific.** The
  `SPACES_*` env vars are renamed to `S3_*` (`S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_REGION`), and a new `S3_ENDPOINT`
  (+ `S3_FORCE_PATH_STYLE` for MinIO) points at any S3-compatible provider — AWS
  S3 (default), Cloudflare R2, MinIO, Backblaze B2, or DigitalOcean Spaces.
  Previously the endpoint was hard-coded to `*.digitaloceanspaces.com` with no
  way to override it. The old `SPACES_*` names are still read as a fallback, so
  existing configs keep working. The drop-in `deploy/` stack passes the `S3_*`
  vars through (off unless `S3_BUCKET` is set).

### Fixed

- **Blob storage is now genuinely optional.** The storage settings module
  validated its credentials eagerly at import and the MCP server imports it on
  boot — so a deployment without object-storage keys failed to start, despite the
  code having a no-op fallback. Storage config is now all-optional (import-safe);
  credentials are resolved only at the point of use and required only when
  `S3_BUCKET` is set (a bucket without keys now fails loudly instead of silently
  dropping bytes).

[0.7.0]: https://github.com/Moai-Team-LLC/AgenticMind/releases/tag/v0.7.0

## [0.6.0] — 2026-06-03

### Changed

- **BREAKING: OpenRouter is no longer a special-cased provider.** Chat is now a
  single OpenAI-compatible seam configured by `CHAT_BASE_URL` (default
  `https://api.openai.com/v1`) + `CHAT_API_KEY` — point it at OpenAI, Ollama,
  vLLM, **or OpenRouter** (`CHAT_BASE_URL=https://openrouter.ai/api/v1`). The
  `CHAT_PROVIDER` switch, the dedicated OpenRouter client (`@openrouter/ai-sdk-provider`),
  and `OPENROUTER_API_KEY` are gone; default models are now `gpt-4o-mini` / `gpt-4o`.
  No capability is lost — OpenRouter is still reachable via the base URL.
  **Migration:** OpenRouter users set `CHAT_BASE_URL=https://openrouter.ai/api/v1`,
  `CHAT_API_KEY=<openrouter-key>`, and `CHAT_MODEL_*` to OpenRouter slugs.
- **Rerank moved to native Cohere.** The optional cross-encoder now calls
  `api.cohere.com/v2/rerank` with `RERANK_API_KEY` + `RERANK_MODEL` (default
  `rerank-v3.5`), overridable via `RERANK_BASE_URL`. No OpenRouter needed. Off by
  default, so retrieval is unaffected unless you had rerank enabled.
- **`material.source` reduced to a single value, `manual`.** The dead
  crawl-connector origins (`http_url` / `google_drive` / `notion` / `telegram`),
  orphaned when the ingestion connectors were removed in 0.3.0, are gone from the
  `MaterialSource` type and the `materials_source_check` constraint. Migration
  `0001` remaps any legacy rows to `manual` before tightening the check, so it is
  safe on pre-0.3 databases. No MCP tool exposes source selection, so the tool
  contract (1.1.0) is unchanged.

### Fixed

- **Stale OpenRouter-era defaults and references purged.** The in-code model
  fallbacks used when `SKIP_VALIDATION` is set (the dev default) were still
  OpenRouter slugs (`openai/gpt-5-mini`, `google/gemini-3.1-flash-lite-preview`)
  that don't resolve against OpenAI — now `gpt-4o` / `gpt-4o-mini`, matching the
  zod defaults. Also swept lingering `OPENROUTER_API_KEY` / `CHAT_PROVIDER`
  mentions out of the docs, Dockerfiles, `setup.sh`, `turbo.json` (cache-key env),
  the calibrate/eval scripts, and a phantom `BullMQ` reference in the worker
  header (the worker is Postgres-only — no broker was ever shipped). The
  contributor guide now correctly describes the engine as language-neutral
  (multilingual bge-m3 + `simple` FTS), not English-only.

### Internal

- **Dropped internal Go-port provenance** from ~40 source-file comments (the
  knowledge layer was extracted from a closed Go service). Behavioral/parity
  notes were preserved; comments only, no code or behavior change.

[0.6.0]: https://github.com/Moai-Team-LLC/AgenticMind/releases/tag/v0.6.0

## [0.5.0] — 2026-06-03

### Added

- **Published container images** — a `release-images` workflow builds and pushes
  `ghcr.io/moai-team-llc/agenticmind-server` and `…-worker` to GHCR on each
  release (and on demand). Self-hosters can `docker pull` instead of
  clone-and-build.
- **`MCP_API_KEY` — one-key auth.** A static shared bearer for simple
  single-tenant self-host: set it, send it. No `issue-token`, no `AUTH_SECRET`,
  no DB token row; grants all scopes (constant-time compared). Minted JWTs remain
  the least-privilege, revocable path.
- **Drop-in deploy stack** — `deploy/docker-compose.yml` + `deploy/gen-secrets.sh`
  bring up Postgres → migrations → server → worker from the GHCR images, reusing
  your existing **OpenAI** key (no OpenRouter). `gen-secrets.sh` auto-generates
  the DB password and MCP key, so the only secret you supply is the OpenAI one
  you already have. See [`docs/DEPLOY.md`](docs/DEPLOY.md).

### Fixed

- **A dropped MCP client no longer crashes the server.** When a client aborts or
  times out mid-request, `mcp-handler` could write to the already-closed response
  stream (`Invalid state: Controller is already closed`), throwing
  asynchronously — outside any per-request `try/catch` — and exiting the process.
  One misbehaving client took down the whole knowledge service. The host now
  swallows that benign disconnect class (and only that class) at the process
  level via `isClientDisconnectError`; genuine faults stay loud and fatal.
- **Docker images build and run again.** `packageManager` had been set to `npm`,
  which made `turbo prune` look for a `package-lock.json` that isn't committed and
  broke the image build (_"Cannot prune without parsed lockfile"_) — reverted to
  `bun`. The images also moved off Alpine to a glibc base, because
  `onnxruntime-node` (the local-embeddings addon) cannot load on musl
  (_"__getauxval: symbol not found"_). The npm CI job installs Bun so Turbo can
  still orchestrate.

[0.5.0]: https://github.com/Moai-Team-LLC/AgenticMind/releases/tag/v0.5.0

## [0.4.1] — 2026-06-02

### Added

- **Blocked-CDN / offline embeddings** — `EMBED_HF_ENDPOINT` (a Hugging Face
  mirror such as `https://hf-mirror.com`) and `EMBED_CACHE_DIR` (a pre-seedable
  model cache) let the default in-process embedder work when the Hugging Face CDN
  (`cdn-lfs.huggingface.co` / `cas-bridge.xethub.hf.co`) is blocked or the host is
  air-gapped. See `docs/OPERATIONS.md` § Switching model providers.

[0.4.1]: https://github.com/Moai-Team-LLC/AgenticMind/releases/tag/v0.4.1

## [0.4.0] — 2026-06-02

### Added

- **`kl_forget` MCP tool** — the inverse of `kl_ingest`: permanently delete a
  material by its UUID and everything derived from it (chunks, embeddings, fact
  cards, graph mentions; best-effort blob cleanup). For retraction /
  right-to-erasure. Requires the new, elevated **`knowledge:admin`** scope
  (strictly above `knowledge:write`). The MCP tool contract is bumped to
  **1.1.0** (additive — existing clients are unaffected).
- **README polish** — an animated `kl_ask_global` demo and the AgenticMind logo
  in the header.

[0.4.0]: https://github.com/Moai-Team-LLC/AgenticMind/releases/tag/v0.4.0

## [0.3.0] — 2026-06-01

Runs on plain Node now — Bun is no longer required — and the knowledge layer is
leaner and strictly MCP-native.

### Added

- **Runtime-agnostic host** — the MCP server runs on plain **Node ≥22.18** (via
  `@hono/node-server`) or **Bun** (`Bun.serve`), behind a single Web-standard
  `fetch` handler. Server and worker scripts run on Node via `tsx`.
- **Package-manager-agnostic install** — install with **npm** or **bun**
  (`*` workspace specifiers + an `.npmrc` for peer resolution). A second CI job
  installs with npm on Node so the path can't silently rot; `bun.lock` stays the
  canonical lockfile.
- Community-health files (`GOVERNANCE`, `SUPPORT`, `ROADMAP`, `PUBLISHING`) and a
  live "See it work" demo in the README.

### Removed

- **The `http_url` ingestion connector** and its SSRF URL-fetcher. The substrate
  is MCP-native: agents carry their own connectors and feed the corpus via
  `kl_ingest`, so an outbound-fetch connector inside the substrate was redundant
  and an unnecessary SSRF surface. The `ingest` CLI keeps `--file` and `--text`.

### Fixed

- Stale migration references in `docs/OPERATIONS.md` after the migration squash.

[0.3.0]: https://github.com/Moai-Team-LLC/AgenticMind/releases/tag/v0.3.0

## [0.2.0] — 2026-06-01

The substrate is now provider-agnostic, multilingual, observable, and
eval-grounded — a quality, self-hostable knowledge & memory layer for agents.

### Added

- **Pluggable model providers** (`EmbeddingsProvider`, `ChatProvider`) — the
  default is a zero-key, offline, in-process **multilingual** embedding model
  (bge-m3, 1024-dim); chat works with OpenRouter or any OpenAI-compatible
  endpoint (Ollama, vLLM, …). OpenRouter is now one option, not a dependency.
- **OpenInference / OpenTelemetry tracing** of the ask pipeline and the worker
  compounding sweep — a portable why-trace (CHAIN → retrieve → synthesize) that
  exports to Phoenix / Langfuse / LangSmith. No-op until an OTLP endpoint is set.
- **Versioned MCP tool contract** (`MCP_CONTRACT_VERSION`, surfaced as
  `serverInfo.version`) with a snapshot guard test, `CONTRACT.md`, and a
  `server.json` registry manifest.
- **Multilingual prompt-injection detection** (EN + RU) in the input guard.
- **Eval suite** grounded in a vendored corpus: ≥50 cases per top-priority
  failure mode and ≥100 calibration labels, generated by a self-validating
  builder (`bun run build-eval`), plus `seed-eval` and `reembed` scripts.
- **Operations runbook** (`docs/OPERATIONS.md`), Conventional Commits enforced
  via commitlint + husky + CI.

### Changed

- **BREAKING:** embedding vectors are now **1024-dim** (was 1536) and the
  full-text search config is language-neutral (`simple`). Re-embed existing
  corpora (`bun run reembed`) and re-apply migrations.
- Knowledge-graph ontology and feedback-signal vocabulary generalized to a
  domain-neutral set.

[0.2.0]: https://github.com/Moai-Team-LLC/AgenticMind/releases/tag/v0.2.0
