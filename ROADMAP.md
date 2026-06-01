# Roadmap

Where AgenticMind is headed. A direction, not a contract. Issues/PRs that move these forward
are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Now

- **Provider-agnostic core** — local embeddings (bge-m3) by default; chat via OpenRouter *or*
  any OpenAI-compatible endpoint. No mandatory cloud key for retrieval. ✅ shipped in v0.2.
- **Observability** — OpenInference/OpenTelemetry spans across retrieve → synth → filter,
  opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`. ✅
- **Versioned MCP contract** — `MCP_CONTRACT_VERSION` + snapshot guard + `server.json`. ✅

## Next

- **Multilingual full-text** — move beyond the `simple`/`english` FTS configs toward
  per-language analyzers (embeddings are already multilingual).
- **Reranking** — optional cross-encoder rerank stage between retrieve and synth (the
  `rerankUsed` flag is already in the trace).
- **Eval harness in CI** — run the bundled eval suite (≥50 cases/mode, judge-labeled) as a
  regression gate, not just locally.
- **GraphRAG on by default** — promote `kl_graph_neighbors` from opt-in to a first-class
  retrieval tier once recall is validated.

## Later / help wanted

- **Managed-Postgres guides** — Supabase / RDS / Neon setup recipes (TLS, pgvector enablement).
- **More compounding signals** — richer programmatic feedback beyond the current set.
- **Reference MCP-client recipes** — Claude Code, Cursor, and SDK snippets for wiring the
  tools in minutes.
- **Published to MCP registries** — see [PUBLISHING.md](PUBLISHING.md).

## Non-goals

- A frontend / admin UI. AgenticMind is a headless substrate; agents are the only consumers.
- Multi-datastore architecture. It stays **Postgres-only** on purpose.

Have something that belongs here? [Open an issue](https://github.com/Moai-Team-LLC/AgenticMind/issues/new/choose).
