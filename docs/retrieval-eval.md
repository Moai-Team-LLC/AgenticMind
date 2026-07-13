# Retrieval evaluation

Retrieval failures and reasoning failures are different diseases. Today the suite
([`evals.md`](evals.md)) measures retrieval only *end-to-end* — `factual_retrieval`
asks "did the right fact make it into the answer?", which can fail for reasons
that live in retrieval **and** in synthesis. That conflation cannot tell you
*which* to fix. This page adds **retrieval-ranking evaluation** as a first-class,
separate category, per [Agentic Product Standard v3.1](https://github.com/Moai-Team-LLC/agentic-product-standard)
Part V (*Retrieval evaluation*).

Citations prove the answer was grounded in what was retrieved; **Recall@k proves
the right memory was retrievable in the first place.** Auditability needs both.

## The retrieval golden set

A labeled set, versioned like the answer eval set, scored against the vector
retrieval layer (`packages/shared/src/database/query/knowledge/chunks.ts` plus the
belief/card queries) *before* synthesis:

```yaml
query: "what is our refund window?"
relevant_memory_ids: [chunk:8f3a…, belief:12, card:refund-policy]   # ids that SHOULD surface
relevance_grade: 3        # optional; 0–3 graded relevance, enables NDCG
provenance:               # ground-truth discipline (Standard Part V)
  rubric_version: 1.0
  labeler: human | model:<id> | hybrid
  label_date: 2026-07-13
  agreement: {raters: 2, kappa: 0.81}
  origin: authored | adjudicated | review_capture
```

`relevant_memory_ids` reference the knowledge schema (chunks / beliefs / cards). A
set without `provenance` is **`unanchored`** and MUST NOT back a release gate
(Standard DoD 22).

## Metrics

Computed over the top-k the retriever returns, per query, then aggregated:

| Metric | What it answers | Use |
| --- | --- | --- |
| **Recall@k** (k = 1, 3, 5, 10) | is a relevant memory in the top-k? | primary |
| **MRR** | how high did the first relevant memory land? | primary |
| **Precision@k** | how much of the top-k is relevant? | when the context budget is tight |
| **NDCG@k** | graded relevance, rank-discounted | only when `relevance_grade` is set |

Reported **alongside** the citation-enforcement metrics, not folded into a single
end-to-end pass rate. A `retrieval_miss` in the staged failure taxonomy
(AgenticPerformance) is exactly a low-Recall@k query.

## The retrieval regression gate

Retrieval quality is decided by three knobs — the **embedding model**, the
**chunking** strategy, and the **index / query parameters** (k, distance, filters).
Any change to one of them MUST pass the gate before deploy:

- **no Recall@5 regression** against the recorded baseline on the retrieval golden
  set (the starting bar);
- **`pass^3`** (stable across three runs) for release-critical suites;
- a changed **embedding model re-baselines the whole set** — embeddings are not
  comparable across models, so this is a first-class, declared re-baseline, never a
  silent drift.

This is a **separate** gate from the answer eval gate (`bun run eval`): an
embedding swap can leave the end-to-end pass rate flat while quietly dropping
Recall@5 — which the answer gate would never catch.

## What this is not

- Not a replacement for `factual_retrieval` / `source_hierarchy` — those stay; this
  adds the ranking view they cannot express.
- Not NDCG-by-default — graded relevance is opt-in; binary Recall@k / MRR is the
  floor (no metric cargo-culting — apply ranking metrics only where there is
  retrieval).

## Acceptance

- [ ] Retrieval golden-set format documented (this page) + a seed set carrying provenance.
- [ ] Harness computes Recall@k / MRR (NDCG when graded) over the vector layer, separate from the answer suite.
- [ ] A `retrieval_ranking` bucket in the eval ledger; metrics reported next to citation-enforcement.
- [ ] CI **retrieval regression gate** on embedding / chunking / index changes (no Recall@5 regression; `pass^3` for release-critical); an embedding-model change re-baselines.
