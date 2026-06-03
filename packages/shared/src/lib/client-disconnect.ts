/**
 * Detects the benign "the client went away mid-stream" error class.
 *
 * A dropped or timed-out MCP client closes its streamable-HTTP response, but the
 * transport (mcp-handler) can still try to write to it from inside the stream
 * pump — throwing `Invalid state: Controller is already closed`
 * (`ERR_INVALID_STATE`), an abort, or a broken pipe. Because that throw happens
 * asynchronously, *after* the request handler returned its Response, it escapes
 * every per-request try/catch and surfaces as an `uncaughtException` /
 * `unhandledRejection`. Left unhandled, Node exits — so a single misbehaving
 * client takes down the whole knowledge service.
 *
 * This predicate matches ONLY that disconnect class so the host can swallow it
 * and keep serving. Genuine application faults are deliberately not matched, so
 * they stay loud (and fatal).
 */
export const isClientDisconnectError = (err?: unknown): boolean => {
  const e = (err ?? {}) as { code?: unknown; name?: unknown; message?: unknown }
  const code = typeof e.code === "string" ? e.code : ""
  const name = typeof e.name === "string" ? e.name : ""
  const message = typeof e.message === "string" ? e.message : String(err)

  if (
    code === "ERR_INVALID_STATE" ||
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    code === "ABORT_ERR" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    name === "AbortError"
  ) {
    return true
  }

  return /controller is already closed|invalid state: .*controller|premature close|broken pipe|\baborted\b|econnreset|epipe/iu.test(
    message,
  )
}
