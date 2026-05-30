/**
 * AgenticMind MCP server — headless. A minimal Bun HTTP host that serves the
 * MCP streamable-HTTP endpoint and a health check. No web framework, no React,
 * no Next — the only consumers are agents over MCP.
 *
 *   GET  /health        → { ok: true }
 *   *    /mcp[/*]        → MCP streamable HTTP (bearer typ="mcp" JWT required)
 */

import { mcpFetch } from "@/mcp"

const PORT = Number(process.env.PORT ?? 3000)

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  fetch(req): Response | Promise<Response> {
    const { pathname } = new URL(req.url)

    if (pathname === "/health" || pathname === "/") {
      return Response.json({ ok: true, service: "agenticmind-mcp" })
    }

    if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      return mcpFetch(req)
    }

    return new Response("Not found", { status: 404 })
  },
})

console.log(`[SERVER] AgenticMind MCP server listening on :${server.port} (MCP at /mcp)`)
