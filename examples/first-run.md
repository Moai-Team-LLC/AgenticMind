# First run — ingest, ask, and read the why-trace

A 3-minute end-to-end once your client is connected (see the per-client guides). Just talk
to your agent in natural language; it calls the `kl_*` tools. The shapes below show what's
happening underneath.

## 0. Have an instance + a client connected

```bash
OPENAI_API_KEY=sk-... sh -c "$(curl -fsSL https://raw.githubusercontent.com/Moai-Team-LLC/AgenticMind/main/quickstart.sh)"
```

Then wire up [Claude Code](./claude-code.md), [Cursor](./cursor.md), or
[Claude Desktop](./claude-desktop.md).

## 1. Ingest some knowledge (`kl_ingest` — needs `knowledge:write`)

> *"Ingest this into the knowledge base: 'AgenticMind enforces citations — no source, no
> claim — and records a replayable why-trace for every answer.'"*

The text is chunked, embedded locally, distilled into fact cards, and graph-extracted. You
get back a material id.

## 2. Ask a question (`kl_ask_global` — needs `knowledge:read`)

> *"What does AgenticMind do when it can't support an answer?"*

```jsonc
// ← response (trimmed)
{
  "answer": "It refuses the unsupported part rather than fabricating it; every supported
             claim is keyed to a numbered source [1].",
  "citations": [{ "number": 1, "materialId": "…", "score": 0.7, "origin": "chunk" }],
  "phases": [{ "phase": "embed" }, { "phase": "retrieve" }, { "phase": "synth" },
             { "phase": "output_filter" }],
  "telemetryId": "…"
}
```

## 3. Read the why-trace

The `phases`, `model`, timings, and `citations` are the **receipt**: what was retrieved,
ranked, and used, addressable later by `telemetryId`. This is the difference between "the
model said so" and "here's the source." Background:
[the why-trace deep-dive](../docs/blog/why-trace.md).

## 4. Ask something the corpus can't support

> *"What's AgenticMind's pricing?"*

With nothing ingested on that topic, the answer is an honest *"the provided sources do not
specify…"* — not an invention. That refusal is the feature.

## 5. Search directly (`kl_search`)

> *"Search the knowledge base for 'citations'."*

Returns the top passages with scores — the raw retrieval layer under `kl_ask_global`.

## Next

- `kl_signal` (scope `knowledge:signal`) feeds the self-improving compounding loop.
- `mem_write` / `mem_recall` give the agent private, time-travellable memory.
- `kl_forget` (scope `knowledge:admin`) is retraction / right-to-erasure.

Full tool + scope map: [`docs/security-model.md`](../docs/security-model.md).
