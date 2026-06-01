# Governance

How decisions are made for AgenticMind. Lightweight by design — it grows with the project.

## Roles

- **Maintainer** — reviews/merges PRs, sets direction, cuts releases. Currently
  [@AlexDuchDev](https://github.com/AlexDuchDev), stewarded by [Moai Team LLC](https://moaiteam.com).
- **Contributor** — anyone who opens an issue or PR.

## How decisions are made

- **Fixes & small features** (bug fixes, docs, a new test, a contained tool tweak) — one
  maintainer approval merges, CI must be green.
- **Substantive changes** (new MCP tool, a change to the contract in [`CONTRACT.md`](CONTRACT.md),
  schema/migration changes, auth or scope changes) — discussed in an issue first, then merged
  with a maintainer approval. Contract changes must bump `MCP_CONTRACT_VERSION` and update the
  snapshot test.
- **Breaking changes** — require a `BREAKING CHANGE:` note in the commit/PR and a
  [`CHANGELOG.md`](CHANGELOG.md) entry following [Conventional Commits](https://www.conventionalcommits.org).

## Non-negotiables

These are architectural commitments, not preferences — PRs that violate them won't merge:

- **Postgres-only.** No Redis/Neo4j/vector-DB sprawl (the graph and queue live in Postgres).
- **Citation-enforced answers.** No source, no claim.
- **Fail-closed, least-privilege auth** on the MCP surface.
- **Zero-key by default** for retrieval (local embeddings).

## Becoming a maintainer

Sustained, high-quality contributions earn an invitation. Do the work in the open.

## Changes to this document

Propose via PR; a maintainer approval is required to merge.
