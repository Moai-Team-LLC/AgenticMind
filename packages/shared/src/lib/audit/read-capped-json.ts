/**
 * Size-bounded JSON body read for HTTP ingestion endpoints — defense against an unbounded-memory
 * DoS. `Request.json()` buffers the entire body before parsing and honours no size limit, and the
 * server's listeners set none, so a single large POST can exhaust the process heap. This reads the
 * body stream while counting bytes and aborts once the cap is exceeded, so at most `maxBytes` is
 * ever materialized. Pure I/O over a web `Request`, so it is unit-testable offline.
 *
 * Content-Length (when present and truthful) short-circuits the read; the streaming counter is the
 * real guard, since Content-Length can be absent or understated.
 */

export type CappedBytesResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: "too_large" }

export type CappedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid_json" }

/** Reads the raw body bytes, materializing at most `maxBytes`. */
export const readCappedBytes = async (
  req: Request,
  maxBytes: number,
): Promise<CappedBytesResult> => {
  const declared = Number(req.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too_large" }
  }

  const body = req.body
  if (body === null) {
    return { ok: true, bytes: new Uint8Array(0) }
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value !== undefined) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return { ok: false, reason: "too_large" }
      }
      chunks.push(value)
    }
  }
  const buffer = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes: buffer }
}

export const readCappedJson = async (req: Request, maxBytes: number): Promise<CappedJsonResult> => {
  const read = await readCappedBytes(req, maxBytes)
  if (!read.ok) {
    return read
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(read.bytes)) as unknown }
  } catch {
    return { ok: false, reason: "invalid_json" }
  }
}
