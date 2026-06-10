# Evals, methodology, and what we don't claim

Trust has to be **measured**, not asserted. This page is the honest ledger: what
the eval suite checks, how we run it, what came back, and where the known gaps
are. We do not claim "zero hallucination" — we claim *grounded on the benchmark,
with the failures published*.

## Methodology

- **Eval-first.** A risk gets a failure-mode bucket that **measures** it against a
  live Postgres + LLM run *before* any fix. We build a fix only for what comes
  back red, then re-measure to green.
- **Three levels.** Level-1 = pure code assertions (citations, grounded­ness floor,
  abstention, PII, status, cache). Level-2 = a binary LLM judge for semantic
  questions (e.g. "is this opinion presented as fact?"). Level-3 (adversarial) is
  future.
- **Failure modes, not "quality".** Cases are organised by the way an answer can
  go wrong; the set grows from real failures.
- **Ablations.** `scripts/ablate.ts` toggles each component (cards / cache /
  contested / Tier-B) off and reports its contribution to pass rate, so every
  degree of freedom is justified by data rather than assumed.

## What the suite checks

| Bucket | What it guards against | Level |
| --- | --- | --- |
| `factual_retrieval` | the right fact is retrieved + stated | 1 |
| `citation_grounding` | claims carry resolving citations; no fabrication phrasing | 1 |
| `out_of_scope` | honest abstention when the corpus can't answer | 1 |
| `faithfulness` | groundedness floor + correct abstention | 1 |
| `prompt_injection` | direct injection in the query is blocked | 1 |
| `indirect_injection` | injection carried inside a source is not obeyed | 1 |
| `conflicting_sources` | disagreeing sources are surfaced (`contested` / status) | 1 |
| `stale_version` | current sources preferred; stale-only answers flagged | 1 |
| `source_hierarchy` | higher-trust sources win; citation recall | 1 |
| `pii_leak` | the answer + snippets carry no PII | 1 |
| `opinion_vs_fact` | a subjective claim is not presented as established fact | 2 |
| `answer_cache_false_hit` | a near-but-different query is not served a cached answer | 1 |

Run it: `bun run eval` (needs `DATABASE_URL` + `CHAT_API_KEY` + a seeded corpus;
the full integration run is deliberate, not on every PR — PR CI runs the harness
unit tests). `EVAL_ONLY=mode1,mode2` restricts to specific buckets.

## Measured (not claimed)

From the safety cycle, on a live run:

- **`pii_leak` found a real leak** — PII was redacted on input but **echoed on
  output**. Fixed with default-on answer + citation-snippet redaction; re-measured
  green.
- **`opinion_vs_fact` → green** — the engine attributes/hedges opinions rather
  than asserting them as fact.
- **`answer_cache_false_hit` → green** — a near-but-different query is synthesised
  fresh; the cache does not serve a wrong cached answer at the current threshold.

These are eval results on a fixture corpus, not absolute guarantees. Your corpus
will surface its own failure modes — add them as buckets.

## Known gaps

- **Feedback-loop entrenchment is not yet covered by an eval.** A popular-but-wrong
  answer could, in principle, be promoted. Today this is mitigated by design — the
  promoter is **judge-gated** (it requires `aggregate_score ≥ threshold` **and** an
  LLM groundedness check, not popularity alone) and the answer-time faithfulness
  gate catches ungrounded claims — but there is **no demotion of a promoted card on
  later negative signals**. A dedicated entrenchment eval + a demotion sweep are
  the next safety work.
- **Tier-B faithfulness is structural-plus-one-judge**, not a full per-claim NLI
  ensemble.
- **PII redaction is regex-based** (email/phone/card/SSN/IPv4) and can over- or
  under-match; it is defence-in-depth, not a guarantee.

## Reproduce

```bash
# seed a corpus, then:
bun run eval                                  # full suite + gate
EVAL_ONLY=pii_leak,opinion_vs_fact bun run eval
dotenvx run -f .env.local -- bun scripts/ablate.ts   # component contributions
```
