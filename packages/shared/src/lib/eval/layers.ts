/**
 * The knowledge-layer manifest — one declarative source of truth for every
 * optional layer in the engine: its env knob, default, purpose, and (where the
 * effect shows on an answer) a pure predicate that proves the layer FIRED.
 *
 * Consumed by:
 *  - the smoke check ("enabled-but-dead" guard) — for each ENABLED layer with an
 *    observable predicate, assert it demonstrably fires; this is the regression
 *    that the answer-cache and GraphRAG outages would have tripped immediately;
 *  - the verification suite — the registry of which layers to probe;
 *  - docs/knobs generation.
 *
 * Pure + unit-tested. The live seed/probe lives in scripts/verify-layers.ts.
 */

import type { AnswerSignals } from "@agenticmind/shared/lib/eval/diagnose"

export type KnowledgeLayer = {
  id: string
  /** Env knob, or null for always-on core. */
  knob: string | null
  /** Default state when the knob is unset. */
  defaultOn: boolean
  purpose: string
  /**
   * Pure predicate: does this answer show the layer fired? null when the effect
   * is not observable on a single answer (ingest/worker-time layers need a DB or
   * behavioural probe instead).
   */
  firedFromAnswer: ((s: AnswerSignals) => boolean) | null
}

export const KNOWLEDGE_LAYERS: readonly KnowledgeLayer[] = [
  {
    id: "answer_cache",
    knob: "KNOWLEDGE_CACHE_ENABLED",
    defaultOn: false,
    purpose: "serve a repeated question without re-calling the LLM; consistent answers",
    firedFromAnswer: (s) => s.servedBy === "cache",
  },
  {
    id: "knowledge_cards",
    knob: "KNOWLEDGE_CARDS_ENABLED",
    defaultOn: false,
    purpose: "distilled fact cards retrieved ahead of raw chunks",
    firedFromAnswer: (s) => s.servedBy === "card_synth",
  },
  {
    id: "contested_sources",
    knob: "KNOWLEDGE_CONTESTED_SOURCES",
    defaultOn: false,
    purpose: "surface facts the retrieved sources disagree on instead of picking one",
    firedFromAnswer: (s) => (s.contestedCount ?? 0) > 0,
  },
  {
    id: "faithfulness_tier_b",
    knob: "KNOWLEDGE_FAITHFULNESS_TIER_B",
    defaultOn: false,
    purpose: "semantic entailment of each cited claim beyond structural citation presence",
    firedFromAnswer: (s) => s.semanticGroundedness !== undefined,
  },
  {
    id: "reranker",
    knob: "RERANK_ENABLED",
    defaultOn: false,
    purpose: "cross-encoder re-orders the retrieval pool so a buried answer chunk surfaces",
    firedFromAnswer: (s) => s.rerankUsed === true,
  },
  {
    id: "graphrag",
    knob: "KNOWLEDGE_GRAPHRAG_ENABLED",
    defaultOn: false,
    // Experimental. On a probe whose corpus has graph neighbours, a populated
    // graph contributes context rows; zero rows on such a probe means the graph
    // is empty — the exact "enabled-but-dead" state (an OpenAI-strict extractor
    // emptied it) that the v0.12.0 removal misread as the feature being useless.
    purpose: "experimental: graph-neighbour context prelude (needs a nullish-tolerant extractor)",
    firedFromAnswer: (s) => (s.graphContextRows ?? 0) > 0,
  },
  {
    id: "pii_redaction",
    knob: "KNOWLEDGE_PII_REDACTION",
    defaultOn: true,
    purpose: "scrub PII from the answer + citation snippets before they leave the engine",
    firedFromAnswer: null, // observable only on a PII-bearing corpus
  },
  {
    id: "acceptance_evaluator",
    knob: "KNOWLEDGE_ACCEPTANCE_EVALUATOR",
    defaultOn: false,
    purpose: "second-stage LLM gate holding low-quality cards at ingest",
    firedFromAnswer: null, // ingest-time; verify via card admission counts
  },
  {
    id: "demotion_sweep",
    knob: "KNOWLEDGE_DEMOTION_ENABLED",
    defaultOn: false,
    purpose: "retract a promoted card whose cluster later turned net-negative",
    firedFromAnswer: null, // worker-time; verify via card status transition
  },
] as const

/** Whether a layer is enabled given the env, honouring its default semantics. */
export const isLayerEnabled = (
  layer: KnowledgeLayer,
  env: Record<string, string | undefined>,
): boolean => {
  if (layer.knob === null) {
    return true
  }
  const raw = env[layer.knob]
  // Default-on layers are disabled only by an explicit "false"; default-off ones
  // are enabled only by an explicit "true".
  return layer.defaultOn ? raw !== "false" : raw === "true"
}

/** Layers that are enabled AND have an answer-observable fired predicate (smoke set). */
export const smokeCheckableLayers = (env: Record<string, string | undefined>): KnowledgeLayer[] =>
  KNOWLEDGE_LAYERS.filter((l) => isLayerEnabled(l, env) && l.firedFromAnswer !== null)
