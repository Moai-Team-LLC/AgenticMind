/**
 * Evidence model (FR-9).
 *
 * An evidence record is immutable, timestamped, and references the exact source artifact it was
 * harvested from (a `guard_events.id`, an `ask-telemetry` id, a `.mcp-tools.lock` hash), so an
 * auditor can trace every claim back to a record. Records are payload-free — a `summary`, never
 * raw incident text (hash-not-text, NFR-3).
 */
import type { Collector } from "@agenticmind/assurance/catalog/schema"

export type Status = "green" | "yellow" | "red"

export type EvidenceRecord = {
  readonly id: string
  readonly controlId: string
  /** Reference to the source artifact this was harvested from. */
  readonly sourceArtifact: string
  readonly collector: Collector
  readonly collectedAt: string
  /** Payload-free description of what the source proves. */
  readonly summary: string
}

export type ControlStatus = {
  controlId: string
  status: Status
  /** Evidence record ids backing this status. */
  drivingEvidence: string[]
  /** AAL Core finding ids that invalidated (or validated) this control. */
  drivingFindings: string[]
  rationale: string
}
