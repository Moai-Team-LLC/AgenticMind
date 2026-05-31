/**
 * OpenTelemetry exporter wiring (opt-in) — Agentic Product Standard, Layer 6.
 *
 * The shared knowledge library is already instrumented via `@opentelemetry/api`
 * (a no-op without a registered provider). This registers a NodeTracerProvider
 * + OTLP/HTTP exporter when OTEL_EXPORTER_OTLP_ENDPOINT is set, so the why-trace
 * flows into Phoenix / Langfuse / LangSmith / any OTLP-compatible backend with
 * zero code changes on the product side. Unset → tracing stays a no-op.
 */

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"

/** Registers an OTLP trace exporter iff OTEL_EXPORTER_OTLP_ENDPOINT is set. */
export const initTracing = (): void => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (endpoint === undefined || endpoint === "") {
    return
  }
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "agenticmind-mcp",
      [ATTR_SERVICE_VERSION]: "0.1.0",
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  })
  provider.register()
  console.log(`[OTEL] tracing enabled → ${endpoint}`)
}
