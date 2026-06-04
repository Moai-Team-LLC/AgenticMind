# We gave every agent answer a receipt: the why-trace

> An engineering deep-dive on how AgenticMind makes retrieval answers auditable.
> Companion to [the AgenticMind repo](https://github.com/Moai-Team-LLC/AgenticMind).

## The problem: agent memory is a black box

Most "memory for agents" is a vector store with two verbs: `save()` and `search()`.
That buys you fuzzy recall and nothing else. When an answer comes back, you can't tell:

- **Why** this passage was chosen and not another.
- **Whether** a source actually supports the claim, or the model filled the gap.
- **Whether** the answer is current, or a stale belief that should have been superseded.

For a demo that's fine. In production — and especially anywhere a regulator might
ask "how did the system arrive at this?" — it's a liability. You're shipping a
component whose decisions you can't reconstruct.

## What we built

AgenticMind treats every answer as something you can **replay**. The retrieval/synthesis
path is two enforced rules plus a recorded decision log:

1. **No source, no claim.** Synthesis is citation-enforced: every statement in an
   answer is keyed to a numbered source, and the unsupported parts are refused
   rather than fabricated.
2. **A receipt for every answer.** Each call emits a structured *why-trace* — the
   retrieval and synthesis steps, the model used, the timings, and the citations,
   all addressable after the fact by a `telemetryId`.

Here's a real `kl_ask_global` call. The question has two halves on purpose — one the
corpus can answer, one it can't:

```jsonc
// → kl_ask_global
{ "question": "When should I use a multi-agent architecture instead of a single agent,
                and what must every agent ship with according to the standard?" }

// ← response (trimmed)
{
  "answer": "The provided sources do not specify when to use a multi-agent architecture
             versus a single agent. … According to the Agentic Product Standard, every
             agent must ship with a written Agent Contract [1]. This contract must cover
             ownership, forbidden actions, acceptance criteria, failure modes, escalation
             rules, and logging requirements [1].",
  "citations": [
    { "number": 1, "title": "Agent Contract requirement",
      "materialId": "ba44971b-…", "score": 0.46, "origin": "chunk" }
  ],
  "model": "…",
  "retrievalMs": 606, "generationMs": 890,
  "phases": [ {"phase":"embed","ms":552}, {"phase":"retrieve","ms":37},
              {"phase":"synth","ms":890}, {"phase":"output_filter","ms":2} ],
  "telemetryId": "cc942e54-…"
}
```

Read what *didn't* happen: the half the corpus couldn't support, the model **refused**
("the provided sources do not specify…") instead of inventing an answer. The half it
could support is keyed to a citation you can open. And the whole thing carries a trace
you can replay.

## What's in the trace

The trace is not a log line — it's a structured record designed to answer "why":

- **`phases`** — the ordered steps with per-phase timings: `embed` → `retrieve` →
  `synth` → `output_filter`. When something is slow or wrong, you see *which* stage.
- **`citations`** — for each cited source: its `materialId`, the retrieval `score`,
  and the `origin` (e.g. a raw chunk vs. a distilled fact card vs. the graph). You can
  see not just *that* a source was used, but *how* it was found.
- **`model`** + **`retrievalMs`/`generationMs`** — what answered, and where the time went.
- **`telemetryId`** — the handle that ties the answer to its trace so you can pull it up
  later, attach it to a support ticket, or feed it into an eval.

Because the trace is captured at decision time (in `packages/shared/src/lib/observability`),
it reflects the real path the engine took — not a reconstruction after the fact.

## Why it matters

- **Debugging.** "The agent gave a weird answer" becomes a concrete investigation:
  open the trace, see which chunk scored 0.46 and got cited, fix the corpus or the
  ranking. No guessing.
- **Trust.** A citation you can open is the difference between "the model said so" and
  "here's the source." Refusal on unsupported questions is a feature, not a failure.
- **Audit & compliance.** Regulated buyers increasingly need *explainable* retrieval —
  the EU AI Act pushes toward systems whose outputs can be traced to their inputs. A
  replayable why-trace is most of that artifact already, by construction rather than
  bolted on.

## The honest tradeoffs

- Citation-enforced synthesis **refuses more**. If your corpus is thin, you'll see
  "the sources don't support this" more often than a chatty vector-store wrapper would.
  We think that's the correct default for anything you'll be accountable for — but it's
  a real behavioral difference, not free.
- Recording a trace per answer has a cost. It's small relative to embedding + generation,
  and it's the kind of cost you only resent until the first production incident.

## Try it

AgenticMind is Apache-2.0 and self-hostable on Postgres alone. One command, no clone,
no token minting:

```bash
OPENAI_API_KEY=sk-... sh -c "$(curl -fsSL https://raw.githubusercontent.com/Moai-Team-LLC/AgenticMind/main/quickstart.sh)"
```

Then point any MCP client at it, ingest something, ask a question — and open the trace.

---

*AgenticMind is the reference implementation of the [Agentic Product Standard](https://github.com/Moai-Team-LLC/agentic-product-standard).*
