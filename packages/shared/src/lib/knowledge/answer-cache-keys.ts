/**
 * Answer-cache key helpers — pure, ported from
 * services/knowledge/internal/synth/cache.go. Question normalisation + sha256
 * hashing drive the exact-match lookup; the source fingerprint captures what
 * the cached answer was conditioned on. No DB — unit-testable.
 */

import { createHash } from "node:crypto"

const TRAILING_PUNCT = new Set(["?", "!", ".", ",", ";"])

/** Canonical form for hash-keying: lowercase, whitespace-collapsed, trailing punctuation stripped. */
export const normaliseQuestion = (input: string): string => {
  let q = input.trim().toLowerCase()
  if (q === "") {
    return ""
  }
  q = q
    .split(/\s+/u)
    .filter((w) => w !== "")
    .join(" ")
  let end = q.length
  while (end > 0 && TRAILING_PUNCT.has(q[end - 1] ?? "")) {
    end--
  }
  return q.slice(0, end)
}

/** Sha256 hex of the normalised question. Stable across processes. */
export const hashQuestion = (q: string): string =>
  createHash("sha256").update(normaliseQuestion(q)).digest("hex")

export type SourceFingerprintInput = {
  materialId: string
  updatedAt: Date
}

/**
 * Stable hash over the cited materials + their updated_at timestamps (sorted
 * by id). Captured at store time; the cache reader uses the materials.updated_at
 * join to detect drift, so this only needs to be self-consistent.
 */
export const fingerprintSources = (inputs: SourceFingerprintInput[]): string => {
  const sorted = [...inputs].toSorted((a, b) =>
    a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0,
  )
  const h = createHash("sha256")
  for (const s of sorted) {
    h.update(`${s.materialId}|${s.updatedAt.toISOString()}\n`)
  }
  return h.digest("hex")
}
