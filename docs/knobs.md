# Configuration knobs

AgenticMind runs with **zero configuration** beyond a database and (for synthesis)
an LLM key. Everything below is **optional** and **off / neutral by default** — the
defaults keep the deploy lightweight and the behaviour unchanged. Turn a knob on
only when you want the capability it buys.

All knobs are environment variables read once at boot.

## Answer quality & trust

| Env var | Default | What it does |
| --- | --- | --- |
| `KNOWLEDGE_FAITHFULNESS_TIER_B` | off | Runs a semantic **entailment** judge over each cited claim (one extra LLM call per `kl_ask_global`). Adds `semanticGroundedness` + `contradictedClaims` to the answer. Tier-A structural groundedness is always computed for free. |
| `KNOWLEDGE_CONTESTED_SOURCES` | off | Runs a judge that surfaces facts where the retrieved sources **disagree** (one extra LLM call). Adds `contested` (each side tagged with source + date) instead of silently picking a winner. |
| `KNOWLEDGE_ANSWER_POLICY` | unset | A JSON policy that **enforces** the signals: `minGroundedness`, `minSemanticGroundedness`, `blockOnConflict`, `reviewOnConflict`, `reviewOnNeedsReview`. A blocked answer is replaced by a refusal; the decision (`policy: { action, reasons }`) is attached to the trace. |
| `KNOWLEDGE_PII_REDACTION` | **on** | Scrubs PII (email/phone/card/SSN/IPv4) from the answer **and** citation snippets before they leave the engine (and before caching). On by default — leaking PII is a defect. Set to `false` only when raw contact info is intended (e.g. an internal directory). |

Every `kl_ask_global` answer carries a single **`status`** an agent can gate on,
derived from the signals above (free, always present):

`supported` · `partial` · `unsupported` · `conflicted` · `needs_review`

> Severity precedence: an honest decline → `unsupported`; conflicting sources →
> `conflicted`; a cited-but-unentailed claim, an answer resting only on stale
> (non-active) sources (`staleSourcesOnly`), **or an answer asserting a numeric
> figure absent from every cited snippet** (`ungroundedFigures`, a deterministic
> no-LLM check) → `needs_review`; otherwise the grounded/partial/unsupported
> gradient.

Example policy (refuse weakly-grounded answers, flag conflicts for a human):

```bash
KNOWLEDGE_ANSWER_POLICY='{"minGroundedness":0.7,"reviewOnConflict":true,"reviewOnNeedsReview":true}'
```

## Source trust

Each material carries a **content lifecycle** (`active` → `deprecated` →
`superseded` → `archived`) and a **trust tier** (integer; higher wins on conflict).
Retrieval down-weights stale/low-trust sources after the recency boost, so a signed
policy outranks a historical note. Defaults (`active`, tier `0`) change nothing. Set
them **at ingest** via `kl_ingest`'s optional `lifecycle` / `trustTier`, or later
with `updateMaterialLifecycle()`. An answer that ends up resting only on stale
sources is flagged (`staleSourcesOnly`, status → `needs_review`).

## Retrieval & corpus

| Env var | Default | What it does |
| --- | --- | --- |
| `RETRIEVAL_PARAMS` | engine defaults | A tuned retrieval profile (hybrid weights / recency / topK / rerank) as JSON. Produced by `scripts/tune.ts`, which optimises against the eval corpus **plus** harvested real queries. |
| `KNOWLEDGE_EVAL_HARVEST` | off | **Privacy-affecting.** When on, the raw question is persisted on the telemetry row (default: only a hash) so signalled real queries can be replayed by the tuner. Leave off unless you want the closed read-path loop. |
| `KNOWLEDGE_CARDS_ENABLED` | off | Distil ingested text into reusable fact cards. |
| `KNOWLEDGE_CACHE_ENABLED` | off | Answer cache for repeated questions. **Only `supported` answers are cached** — a hallucinated / weakly-grounded / conflicted answer is never stored and then served back confidently to many agents (the cache amplifies whatever it holds). |

## Compounding loop (worker)

| Env var | Default | What it does |
| --- | --- | --- |
| `KNOWLEDGE_ACCEPTANCE_EVALUATOR` | off | A second-stage LLM gate over extracted cards at ingest (accept / reject / merge / human_review). One extra LLM call. |
| `KNOWLEDGE_DEMOTION_ENABLED` | off | **Anti-entrenchment brake.** The worker sweep demotes a *promoted* resolution card to `deprecated` once its cluster's aggregate feedback score falls to/below a negative floor over enough signals — so a once-popular answer the community later rejects stops surfacing. The card is kept (audit trail intact), not deleted. Off by default; only meaningful once the promoter has run. |

## Multi-tenant

| Env var | Default | What it does |
| --- | --- | --- |
| `DATABASE_APP_ROLE` | unset | Downgrades each request transaction to a least-privilege Postgres role via `SET LOCAL ROLE`, so row-level security is enforced even on an owner/superuser connection. Set this whenever you rely on tenant isolation. |

Tenant scoping itself is automatic: a token carries a tenant, every request runs in
its tenant context, and RLS policies enforce isolation on read and write. See the
[security model](security-model.md).

## Cost

Tier-B faithfulness and contested-sources each add **one** LLM call per
`kl_ask_global` **when enabled** — both default off. The answer cache (when on)
serves repeats without re-paying. Per-run output ceilings and per-call token usage
are recorded in the trace.
