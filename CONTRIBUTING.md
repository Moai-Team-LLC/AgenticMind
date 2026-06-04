# Contributing to AgenticMind

Thanks for helping improve AgenticMind — the auditable, self-improving knowledge &
memory layer for agents, and a reference implementation of
[the Agentic Product Standard](https://github.com/Moai-Team-LLC/agentic-product-standard).

## Getting started

```bash
cp .env.example .env.local      # set CHAT_API_KEY + AUTH_SECRET
./setup.sh                      # deps + Postgres + migrations
bun run check                   # typecheck + tests — must pass before a PR
```

- **Runtime:** Bun ≥1.3 (package manager, test runner, host).
- **Database:** Postgres + pgvector (flagship — no other datastore).
- **Node ≥22.18** is required only for `bun run lint` (oxlint loads a TypeScript
  config). `tsc` and `bun test` run under Bun and need no Node.

## Ground rules

1. **Keep it Postgres-only.** The flagship runs on Postgres + pgvector alone. New
   hard dependencies on Redis/Neo4j/ClickHouse/etc. belong behind an interface
   (e.g. `GraphStore`), not in the default path.
2. **Keep it language-neutral.** The engine is multilingual: embeddings use a
   multilingual model (bge-m3) and full-text search uses the language-neutral
   `simple` config. Don't switch FTS to a language-specific config (e.g.
   `english`) or hardcode one language's lexicon — it silently degrades retrieval
   for every other language.
3. **Don't regress the moat.** Citation-enforced synthesis, the replayable decision
   trace, the judge-gated compounding loop, and tiered retrieval are the core —
   changes there need tests and a clear rationale.
4. **Structured + typed.** Validate inputs/outputs; prefer typed results
   (`neverthrow` Result) over throwing on expected failures.
5. **Permissions in code.** MCP tools are scoped least-privilege and fail closed.
   Keep auth/scope enforcement in code, never in a prompt.

## Tests & evals

- `bun test` — unit tests (engine, guardrails, judge calibration, eval harness).
- `bun run eval` — full integration eval against the live engine; needs
  `DATABASE_URL` + `CHAT_API_KEY`. It exits non-zero on regression vs the
  baseline pass rate. CI runs the unit suite; run the eval before changing
  retrieval/synthesis behavior.
- Add a test for every bug fix and every new tool or behavior.

## Pull requests

1. Branch: `git checkout -b feat/short-description`.
2. Make the change; ensure `bun run check` is green.
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
   (e.g. `feat(mcp): add kl_summarize tool`).
4. Open a PR describing **what changed and why**, with tests.

## Code of Conduct

Be direct, be kind, argue from evidence.

## Contributor License Agreement (CLA)

The first time you open a PR, a bot asks you to sign the project [CLA](CLA.md) by
posting one comment — a one-time signature recorded on the `cla-signatures`
branch that applies to all your future contributions. The CLA confirms you have
the right to contribute and grants Moai Team LLC a broad, sublicensable license
to your contribution. This is what lets the Project offer a future commercial
edition on top of the open core **without** relicensing the open core, which
stays Apache-2.0. Maintainers and bots are exempt.

## License

The Project is licensed under [Apache-2.0](LICENSE). Your contributions are
released under the same license, in addition to the grant in the [CLA](CLA.md).
