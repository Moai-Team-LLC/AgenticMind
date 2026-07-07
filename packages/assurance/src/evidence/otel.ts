/**
 * Generic collector — OpenTelemetry GenAI spans (FR-9.2).
 *
 * For non-AgenticMind targets there is no engine schema to read, so evidence is harvested from
 * whatever telemetry the target can export. This ingests OTel GenAI spans (spans carrying the
 * `gen_ai.*` semantic-convention attributes) and produces `collector: "generic"` evidence — a
 * DEGRADED signal versus native. The gap engine will not score a native-required control GREEN on
 * generic evidence (see score.ts), and every bundle's coverage ratio flags the mix, so results are
 * never over-claimed (NFR-8).
 *
 * Payload-free: only span counts + trace refs become evidence, never prompt/response text.
 */
import { z } from "zod"

import type { EvidenceRecord } from "./schema"

/** A minimal OTel span shape — we only need its attributes and identity. */
export const OtelGenAiSpan = z.object({
  name: z.string().default(""),
  attributes: z.record(z.string(), z.unknown()).default({}),
  traceId: z.string().optional(),
  spanId: z.string().optional(),
})
export type OtelGenAiSpan = z.infer<typeof OtelGenAiSpan>

/** A span counts as a GenAI span if it carries any `gen_ai.*` attribute (OTel GenAI semconv). */
export const isGenAiSpan = (span: OtelGenAiSpan): boolean =>
  Object.keys(span.attributes).some((k) => k.startsWith("gen_ai."))

const rec = (
  controlId: string,
  sourceArtifact: string,
  collectedAt: string,
  summary: string,
): EvidenceRecord => {
  return {
    id: `ev:generic:${controlId}:${sourceArtifact}`,
    controlId,
    sourceArtifact,
    collector: "generic",
    collectedAt,
    summary,
  }
}

/**
 * Turn OTel GenAI spans into generic evidence: a decision trace exists (traceability, AAL-ACC-01,
 * degraded vs the native why-trace) and a behavioral record for rogue-agent baselining
 * (AAL-REL-03, whose required collector IS generic). `collectedAt` is passed in for determinism.
 */
export const collectFromOtelSpans = (
  spans: OtelGenAiSpan[],
  collectedAt: string,
): EvidenceRecord[] => {
  const genAi = spans.filter((s) => isGenAiSpan(s))
  if (genAi.length === 0) {
    return []
  }
  return [
    rec(
      "AAL-ACC-01",
      `otel_genai_spans:${genAi.length}`,
      collectedAt,
      `${genAi.length} OTel GenAI span(s) provide a decision trace (generic — not the native why-trace).`,
    ),
    rec(
      "AAL-REL-03",
      `otel_genai_spans:${genAi.length}`,
      collectedAt,
      `${genAi.length} OTel GenAI span(s) provide a behavioral record for baselining.`,
    ),
  ]
}
