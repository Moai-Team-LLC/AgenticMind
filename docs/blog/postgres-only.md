# Why AgenticMind runs on Postgres alone (no Redis, no Neo4j, no vector DB)

> An architecture-rationale post. Companion to [the AgenticMind repo](https://github.com/Moai-Team-LLC/AgenticMind).

## The default stack is sprawl

Stand up a "serious" agent knowledge layer the usual way and your `docker-compose`
grows fast: a vector database for embeddings, a graph database for relationships,
Redis for the job queue and caching, Postgres for the boring relational data. Four
datastores, four failure modes, four things to back up, secure, version, and pay for —
before you've answered a single question.

For a self-hosted product, that sprawl *is* the adoption tax. Every extra service is
another reason the thing doesn't run on the first try.

We made the opposite bet: **one datastore.** Everything AgenticMind needs, Postgres
already does.

## What Postgres carries

- **Vectors** — `pgvector` for embeddings. The flagship image bundles `pgvectorscale`
  so we get the `diskann` index method for fast approximate search at scale, no separate
  vector DB.
- **Full-text** — Postgres `tsvector`/`tsquery`. We default to the language-neutral
  `simple` configuration so retrieval stays multilingual instead of silently degrading
  for every language that isn't English. Hybrid vector + full-text, recency-aware.
- **The graph** — relationships live behind a `GraphStore` interface, implemented with
  **recursive CTE** traversal on Postgres. No Neo4j to run for the common case.
- **The durable queue** — the compounding worker's jobs are scheduled in Postgres, not
  Redis. Durable by default, visible in SQL, recoverable like any other row.

So the tiered retrieval path — chunks → typed fact cards → knowledge graph — and the
self-improvement loop that promotes validated knowledge back into the corpus both run
against a single engine.

## Why this is the right default

- **Time-to-first-value.** `docker compose up` with one stateful service comes up
  reliably. Fewer moving parts is the whole pitch of self-hosting.
- **One thing to operate.** One backup story, one security boundary, one connection
  string, one place to look when something's slow. For a small team running this in
  production, that's not a nice-to-have — it's whether you run it at all.
- **Transactions across concerns.** Ingest writes chunks, fact cards, graph edges, and
  a queue job. When those live in one database, they live in one transaction. Distributed
  consistency across four stores is a problem we simply don't have.
- **Postgres is boring, and boring scales.** pgvector + vectorscale is no longer a toy;
  managed Postgres is everywhere; the operational knowledge already exists in every team.

## Where you'd outgrow it (and why the interface matters)

This is a bet, not a religion. There are real points where a specialized store wins:

- Graph workloads with deep, high-fan-out traversal and graph-native query patterns will
  eventually beat recursive CTEs — which is exactly why the graph sits behind a
  `GraphStore` interface, not hard-wired. Swap the implementation, keep the engine.
- Embedding volumes far past a single node may justify a dedicated vector service.
- Very high-throughput queueing may justify a real broker.

The point isn't "Postgres forever." It's: **start with one datastore, keep the seams at
interfaces, and add a service only when a measured limit forces it** — not because the
reference architecture diagram had four boxes.

## Try it

Apache-2.0, self-hostable, one command:

```bash
OPENAI_API_KEY=sk-... sh -c "$(curl -fsSL https://raw.githubusercontent.com/Moai-Team-LLC/AgenticMind/main/quickstart.sh)"
```

---

*AgenticMind is the reference implementation of the [Agentic Product Standard](https://github.com/Moai-Team-LLC/agentic-product-standard).*
