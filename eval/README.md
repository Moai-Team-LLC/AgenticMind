# Eval set

Cases are organised by **failure mode**, not generic "quality" (per the Agentic
Product Standard). Each new production failure should become a permanent case
here. Target: ≥50 cases per top-priority failure mode.

- **Level 1 (code assertions)** — the `assertions` on each case (citations,
  must/forbid phrases, expectBlocked). Cheap, deterministic, run on every change.
- **Level 2 (LLM-as-judge)** — add a binary `assertions.judge` question; the
  runner calls the configured judge. Calibrate the judge against
  `judge-labels.json` (TPR/TNR) before trusting it.
- **Level 3 (human review)** — sample production traces (`ask_telemetry`) weekly.

Run: `bun run eval` (needs `DATABASE_URL` + `OPENROUTER_API_KEY`). The harness
logic itself is unit-tested in `lib/eval/harness.test.ts` (no infra needed).

Current failure modes: factual_retrieval, out_of_scope, prompt_injection,
citation_grounding. Add memory_recall + belief_conflict cases as the memory
surface matures.
