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
- **entrenchment demotion → green** — `scripts/entrenchment-eval.ts` on a live
  Postgres: a promoted card (`approved`) whose cluster was driven net-negative
  (aggregate score −2.45 over 6 signals) was demoted to `deprecated` by the sweep
  and stopped being retrievable. Deterministic and self-cleaning.
- **full-pipeline entrenchment → green** — `scripts/entrenchment-eval-full.ts`
  exercises *both* ends with a real LLM judge: a grounded answer was promoted
  through the judge gate to an `approved` card, then — after the cluster turned
  net-negative (score −1.00 over 9 signals) — retracted to `deprecated`. The whole
  promote→demote lifecycle, proven live.
- **full-suite baseline → 224/234 (95.7%)** on a live OpenAI run, gate passed;
  citation precision/recall 100%; every safety bucket green (`pii_leak`,
  `opinion_vs_fact`, `answer_cache_false_hit`, `indirect_injection`,
  `conflicting_sources`, `stale_version`, `source_hierarchy`). The 10 misses were
  exact-phrase assertions the synthesis paraphrased, plus two abstention cases
  (see *Abstention posture* below — a deliberate design choice, not a defect).

### Abstention posture — surface, don't decide

Two `faithfulness` cases (`faith-3`/`faith-4`: "how do neutron stars form?",
"corporate tax rate in Japan?") assert `expectAbstain: true` and were counted as
misses. This is **not** the engine answering confidently from parametric memory —
it's an intentional, unit-tested design boundary worth stating plainly:

- On a fully out-of-corpus query, retrieval still returns weakly-similar chunks
  (`sourceCount > 0`), so the engine synthesises but **cites nothing it can ground**
  → `citations = 0`, `groundedness = 0`, **`status = unsupported`**. The weakness is
  *surfaced and gate-able*, not hidden.
- The engine **hard-declines** (`abstained = true`) only when no sources were
  retrieved at all, on explicit refusal phrasing, or — by opt-in — under a
  `KNOWLEDGE_ANSWER_POLICY` whose `minGroundedness` converts a `groundedness = 0`
  answer into a refusal. This is the project's *surface-not-decide* default: the
  engine reports the signal; the operator chooses how hard to gate.
- This is locked by `faithfulness.test.ts` ("a confident but entirely uncited
  answer is ungrounded, **not** abstained"). So those two cases assert the
  *policy-on* behaviour under a *policy-off* run — an expectation mismatch, not an
  overconfidence hole. Run that bucket under an answer policy and they decline.

### Ablation (what earns its complexity)

`scripts/ablate.ts` over a 63-case representative subset (each component toggled
off vs the all-on baseline of 90.5%):

| Component off | Pass rate | Contribution |
| --- | --- | --- |
| knowledge cards | 90.5% | +0.0 pts |
| answer cache | 90.5% | +0.0 pts |
| contested-sources | 88.9% | **+1.6 pts** |
| Tier-B faithfulness | 88.9% | **+1.6 pts** |

Read it honestly: the two LLM-judge safety features (contested-sources, Tier-B)
measurably improve correctness on this corpus and earn their extra call; cards and
cache are **latency/efficiency** features, correctness-neutral here (their value is
speed and cost, which this pass-rate metric doesn't capture). A different corpus
will shift these numbers — re-run the ablation on yours before cutting anything.

These are eval results on a fixture corpus, not absolute guarantees. Your corpus
will surface its own failure modes — add them as buckets.

## Known gaps

- **Feedback-loop entrenchment** is now closed on both ends and proven live (see
  *Measured* above): promotion is judge-gated in, demotion (`KNOWLEDGE_DEMOTION_ENABLED`,
  off by default) retracts a net-negative card out, and both the demotion-only and
  full promote→demote lifecycles pass against a live Postgres. The residual caveat
  is honest: these are **on-demand evals on fixtures**, not a standing production
  monitor, and demotion is **one-directional** — a demoted card is not
  auto-re-promoted if sentiment later recovers (an admin re-opens it via SQL).
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

# anti-entrenchment demotion (DATABASE_URL only — no LLM; self-cleaning):
dotenvx run -f .env.local -- bun scripts/entrenchment-eval.ts

# full promote→demote lifecycle with a real LLM judge (needs CHAT + EMBED):
dotenvx run -f .env.local -- bun scripts/entrenchment-eval-full.ts
```
