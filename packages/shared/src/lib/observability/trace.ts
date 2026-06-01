/**
 * OpenTelemetry instrumentation seam (Agentic Product Standard — Layer 6:
 * "instrument via OpenInference / OpenLLMetry so you can swap vendors without
 * re-instrumenting"). This module depends ONLY on `@opentelemetry/api`, which is
 * a no-op until a TracerProvider is registered by the host process. So the
 * library is always instrumented at zero cost; an operator turns on export by
 * registering an exporter (see apps/server/src/tracing.ts).
 *
 * Attributes follow the OpenInference semantic conventions recognized by
 * Phoenix / Langfuse / LangSmith, so the why-trace lands in any of them.
 */

import type { Span } from "@opentelemetry/api"

import { SpanStatusCode, trace } from "@opentelemetry/api"

export const tracer = trace.getTracer("agenticmind")

/** OpenInference span kinds (subset used by the knowledge pipeline). */
export const SpanKind = {
  CHAIN: "CHAIN",
  RETRIEVER: "RETRIEVER",
  LLM: "LLM",
} as const
export type SpanKind = (typeof SpanKind)[keyof typeof SpanKind]

/** OpenInference + AgenticMind span attribute keys. */
export const Attr = {
  SPAN_KIND: "openinference.span.kind",
  INPUT_VALUE: "input.value",
  OUTPUT_VALUE: "output.value",
  LLM_MODEL: "llm.model_name",
  RETRIEVAL_DOC_COUNT: "retrieval.documents.count",
  SERVED_BY: "agenticmind.served_by",
  CITATION_COUNT: "agenticmind.citation_count",
  RETRIEVAL_MS: "agenticmind.retrieval_ms",
  GENERATION_MS: "agenticmind.generation_ms",
} as const

/** Truncate attribute values so a span never carries an unbounded payload. */
const cap = (s: string, max = 2000): string => (s.length <= max ? s : `${s.slice(0, max)}…`)

/**
 * Runs `fn` inside an active span of the given OpenInference kind, recording
 * exceptions and ending the span. The span is a no-op unless an exporter is
 * registered, so this is safe to call unconditionally on the hot path.
 */
export const withSpan = async <T>(
  name: string,
  kind: SpanKind,
  fn: (span: Span) => Promise<T>,
): Promise<T> =>
  tracer.startActiveSpan(name, async (span) => {
    span.setAttribute(Attr.SPAN_KIND, kind)
    try {
      return await fn(span)
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw error
    } finally {
      span.end()
    }
  })

/**
 * Emits an already-finished child span with explicit start/end (epoch ms) under
 * the current active span. For instrumenting a phase that already completed
 * (timed via Date.now()) without restructuring control flow — a no-op unless an
 * exporter is registered.
 */
export const recordChildSpan = (
  name: string,
  kind: SpanKind,
  startMs: number,
  endMs: number,
  attributes?: Record<string, string | number | boolean>,
): void => {
  const span = tracer.startSpan(name, { startTime: startMs })
  span.setAttribute(Attr.SPAN_KIND, kind)
  if (attributes !== undefined) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value)
    }
  }
  span.end(endMs)
}

/** Sets an input.value attribute (capped). */
export const setInput = (span: Span, value: string): void => {
  span.setAttribute(Attr.INPUT_VALUE, cap(value))
}

/** Sets an output.value attribute (capped). */
export const setOutput = (span: Span, value: string): void => {
  span.setAttribute(Attr.OUTPUT_VALUE, cap(value))
}
