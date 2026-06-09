# What counts as a unit of knowledge

The single contract the whole pipeline serves — for the **machine**, not just the
reader. Extraction, acceptance, storage, ranking, retrieval, permissions, and
cleanup all derive from it. A pretty definition is not enough; the engine needs a
*recognition → normalization → storage → use* contract.

> A conversation is **evidence**, not knowledge. Knowledge begins when a raw
> signal is transformed into a **typed, source-grounded, context-scoped, reusable
> unit** that can safely support future action, learning, matching, answering,
> reporting, or artifact generation.

AgenticMind enforces the **use** side of this contract already — *no source, no
claim; no trace, no trust* (citation-enforced synthesis, Tier-A/B faithfulness,
the derived answer `status`, contested-source surfacing, source lifecycle/trust).
This page defines the **admission** side: what may become a stored Knowledge Unit.

## Scope: generic substrate vs. domain product

AgenticMind is a **generic** knowledge substrate. A Knowledge Unit here is
domain-neutral; its `kind` is an open, extensible label. Domain typologies —
e.g. a community's `expertise / need / offer / relationship / intro`, per-type
fields, audience permissions, or reuse modes like "weekly report" — belong in the
**product layer built on top**, not in the core. The core's job is the spine
below; products specialise it.

## The contract

```text
KU = Claim(type, subject, predicate, object)
   + Evidence(source_refs, authority)
   + Scope(context, permissions)
   + Validity(time, confidence)
   + Reuse(modes)
   + Lifecycle(status)
```

Every Knowledge Unit must answer: **(1)** what is claimed · **(2)** about
whom/what · **(3)** from where · **(4)** in what context · **(5)** how confident ·
**(6)** who may use it · **(7)** how it may be reused · **(8)** when it
expires/needs review · **(9)** what it supports/contradicts · **(10)** is it
accepted / reviewed / deprecated.

## Raw ≠ knowledge

```text
Raw data       ≠ knowledge
Conversation   ≠ knowledge
Summary        ≠ knowledge
Insight        ≠ knowledge by default   (interpretation → store as hypothesis)
Knowledge      = typed, grounded, reusable, scoped, time-qualified claim
```

## Card kinds today (generic)

The extractor emits one of six domain-neutral kinds — `fact`, `qa`, `definition`,
`metric`, `procedure`, `resolution` — each a source-grounded, typed, embedded
unit. The set is intentionally generic and extensible; a vertical adds its own
kinds in the product layer rather than bloating the core.

## Acceptance contract — what may be STORED

Two stages: **extract → evaluate**. Never trust extraction alone. An extracted
item becomes an accepted Knowledge Unit only if it is:

1. **Atomic** — one claim / question / answer / procedure / resolution.
2. **Source-grounded** — ≥1 source_ref to raw evidence.
3. **Typed** — exactly one kind.
4. **Subject-identified** — an identifiable subject or scope.
5. **Context-scoped** — where it is valid (tenant / space / topic / time window).
6. **Temporally qualified** — `created_at` + observed time; `valid_from` /
   `valid_to` / decay where needed.
7. **Confidence-scored** — `score` + `reason` + `method`.
8. **Permission-scoped** — who may use/view it (tenant isolation; PII level).
9. **Reuse-tagged** — how it may be reused.
10. **Status-tracked** — candidate → reviewed → approved → deprecated → archived.

Reject (or keep as raw evidence): conversation fragments · no reusable claim · too
vague · no source · permission-restricted · speculation-as-fact · non-additive
duplicates · unresolved conflict with higher-authority knowledge · time-sensitive
but unqualified · not safely reusable.

## Maturity levels

```text
L0 Raw Signal          — message / doc / transcript           (materials, chunks)
L1 Extracted Candidate — system proposed a unit               (card, status=candidate)
L2 Grounded Knowledge  — source + type + subject + confidence + scope
L3 Reviewed Knowledge  — human or trusted rule confirmed it
L4 Operational         — usable in answers / reports
L5 Canonical           — baseline org knowledge
```

## Where this build stands

✓ have · ◑ partial · ✗ missing — against the AgenticMind core.

| Capability | Status |
|---|---|
| Typed claims (6 generic kinds) | ✓ `fact/qa/definition/metric/procedure/resolution` |
| Source grounding + citations | ✓ |
| Time validity + decay | ✓ `valid_from`/`valid_to`; belief-confidence half-life |
| Confidence score | ✓ (◑ `reason`/`method` pending) |
| Context scope | ◑ tenant (RLS) + space; topic/time-window implicit |
| Permissions / PII | ◑ tenant RLS; no PII level on cards |
| Use-side gate (faithfulness, answer `status`, contested) | ✓ |
| Source lifecycle + trust tier | ✓ (on materials) |
| **Card status lifecycle** | ✗ → planned |
| **Evidence authority tier** | ✗ → planned |
| **Confidence method/reason** | ✗ → planned |
| **Acceptance evaluator (2nd stage)** | ✗ → planned |
| Reuse modes | ✗ (product layer) |
| Domain typology (expertise/need/offer/…) | ✗ by design (product layer) |

## The two agents

- **Extraction agent** (`cards-extractor.ts`): extract reusable Knowledge Units,
  not summaries — typed, source-grounded, context-scoped. Skip chat fragments,
  jokes, greetings, reactions, vague opinions, private info, speculation-as-fact,
  non-additive duplicates. Interpretation → lower confidence, flagged for review.
- **Acceptance evaluator** (planned): decide **accept / reject / merge /
  human_review** per candidate — the admission gate. Today approximated by the
  deterministic `validateRawCard` checks plus admin cleanup; a real LLM evaluator
  (merge / conflict / PII / review) is the next quality lever.

## Doctrine

> The system does not treat conversations as knowledge. It treats conversations
> as **evidence**. Knowledge begins when a raw signal becomes a typed,
> source-grounded, context-scoped, reusable unit that can safely support future
> action, learning, matching, answering, reporting, or decision-making.
