/**
 * AgenticMind MCP server — headless and runtime-agnostic. A minimal HTTP host
 * that serves the MCP streamable-HTTP endpoint and a health check through a
 * single Web-standard `fetch` handler. It runs on plain Node (via
 * @hono/node-server) or on Bun (native Bun.serve) — no web framework, no React,
 * no Next. The only consumers are agents over MCP.
 *
 *   GET  /health        → { ok: true }
 *   *    /mcp[/*]        → MCP streamable HTTP (bearer typ="mcp" JWT required)
 */

import { mcpFetch } from "@/mcp"
import { initTracing } from "@/tracing"

// Register the OTLP trace exporter before serving, if configured (no-op otherwise).
initTracing()

const PORT = Number(process.env.PORT ?? 3000)

/** Web-standard request handler — identical under every runtime. */
const fetchHandler = (req: Request): Response | Promise<Response> => {
  const { pathname } = new URL(req.url)

  if (pathname === "/health" || pathname === "/") {
    return Response.json({ ok: true, service: "agenticmind-mcp" })
  }

  if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
    return mcpFetch(req)
  }

  return new Response("Not found", { status: 404 })
}

// Serve on whichever runtime is actually present. Bun ships a native HTTP
// server; on Node we use @hono/node-server, which runs a `fetch` handler with
// correct streaming for the MCP streamable-HTTP transport. The handler above is
// byte-for-byte identical across both — only the listener differs.
if ((globalThis as { Bun?: unknown }).Bun !== undefined) {
  Bun.serve({ port: PORT, idleTimeout: 120, fetch: fetchHandler })
} else {
  const { serve } = await import("@hono/node-server")
  serve({ port: PORT, fetch: fetchHandler })
}

console.log(`[SERVER] AgenticMind MCP server listening on :${PORT} (MCP at /mcp)`)
