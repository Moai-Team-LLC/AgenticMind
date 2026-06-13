# Layer verification & pipeline diagnostics

How we test each layer and localise failures — standardised, so it isn't
re-invented per incident. (This is the lesson of the answer-cache and GraphRAG
outages: both were *enabled but silently doing nothing*, and ad-hoc checking
missed them.)

The engine is a stack of optional layers (cache, cards, contested-sources,
Tier-B faithfulness, reranker, acceptance evaluator, demotion sweep). One
declarative manifest — `packages/shared/src/lib/eval/layers.ts` — is the single
source of truth for each: its env knob, default, purpose, and (where the effect
shows on an answer) a pure predicate proving it *fired*. Three tools consume it.

## 1. Layer verification suite — *does each layer do its job?*

Each layer is tested by the **signal it exists to produce**, never by pass rate
(pass rate is blind to cache/rerank/etc. — that blindness is what hid the cache
bug). Examples, all validated live:

- **contested** — on a planted conflict, ON yields `status=conflicted` + both
  sides; OFF picks one silently.
- **cards** — a fact query returns `servedBy=card_synth` with cards on.
- **reranker** — on a corpus where the answer chunk is buried below `topK`,
  recall went 2/5 (off) → 5/5 (on).
- **cache** — repeated-query workload: 0% → 75% hit, answers byte-identical.
- **demotion** — a promoted card whose cluster turns net-negative is retracted.

Run: `bun run verify-layers` (live DB + key; off the PR critical path).

## 2. "Enabled-but-dead" smoke check — *if a layer is on, it must fire*

`smokeCheckableLayers(env)` selects every enabled layer with an answer-observable
predicate; the smoke runner asserts each demonstrably fires on a minimal probe.
This is the cheap regression that the cache (0% hit) and GraphRAG (0 graph rows)
failures would have tripped on the first run. Run it after any change that
touches retrieval/synthesis or before trusting a new deployment's flags.

## 3. Pipeline diagnostics — *a bad answer: where do I fix it?*

`classifyAnswer(signals)` (`packages/shared/src/lib/eval/diagnose.ts`) codifies
the symptom→stage→knob runbook (OPERATIONS §6) as a pure, unit-tested function.
The CLI feeds it a live answer's why-trace:

```bash
dotenvx run -f .env.local -- bun scripts/diagnose.ts "your question"
```

It prints the trace (`status`, `servedBy`, per-stage timings, groundedness,
contested, citations) and the ranked diagnosis — e.g. *0 citations + groundedness
0 → synthesis/retrieval, set `KNOWLEDGE_ANSWER_POLICY minGroundedness`*, or
*servedBy=cache → a stale/false-hit, isolate with `KNOWLEDGE_CACHE_ENABLED=false`*.
A grounded-but-wrong answer is correctly blamed on the **source/corpus**, not the
pipeline.

## The standard

Adding a layer means adding one manifest entry (knob, default, purpose, fired
predicate) + one suite probe. That automatically enrols it in the smoke check and
makes its failures classifiable. No layer ships without a way to prove it works
and a way to localise it when it doesn't.
