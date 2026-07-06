/**
 * Control Catalog schema (FR-7).
 *
 * Validates `aal-control-catalog.yaml` — the crosswalk mapping each stable AAL control id to an
 * AIUC-1 domain, OWASP Agentic id(s), an ISO 42001 area, the evidence that proves it, the
 * Plane-A test that validates it, and its Green/Yellow/Red status rule. The catalog is data,
 * versioned independently of code (AIUC-1 refreshes quarterly), so this only loads/validates it.
 *
 * Fail-closed: an unknown OWASP ASI id or a missing required field is a validation error.
 */
import { z } from "zod"

export const OwaspAsi = z.enum([
  "ASI01",
  "ASI02",
  "ASI03",
  "ASI04",
  "ASI05",
  "ASI06",
  "ASI07",
  "ASI08",
  "ASI09",
  "ASI10",
])
export type OwaspAsi = z.infer<typeof OwaspAsi>

/** The six AIUC-1 domains (A Data & Privacy … F Society). */
export const Aiuc1Domain = z.enum(["A", "B", "C", "D", "E", "F"])
export type Aiuc1Domain = z.infer<typeof Aiuc1Domain>

/** native = auto-read from an engine artifact · generic = OTel/manual for other agents · manual = human/doc. */
export const Collector = z.enum(["native", "generic", "manual"])
export type Collector = z.infer<typeof Collector>

/** Plane-A attack classes that can validate a control (must match AAL Core's classes). */
export const AttackClass = z.enum([
  "prompt-injection",
  "indirect-injection",
  "tool-poisoning",
  "tool-shadowing",
  "mcp-rug-pull",
  "data-exfil",
  "trifecta-exploit",
  "config-rce",
])
export type AttackClass = z.infer<typeof AttackClass>

/** v1.0 scope filter: `core` = strong native evidence (Security + Accountability); rest deferred. */
export const ControlScope = z.enum(["core", "expand", "deferred"])
export type ControlScope = z.infer<typeof ControlScope>

export const ControlEntry = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  scope: ControlScope,
  aiuc1_domain: Aiuc1Domain,
  aiuc1_confirm: z.boolean().default(true),
  owasp_asi: z.array(OwaspAsi).default([]),
  iso42001: z.array(z.string()).default([]),
  iso_confirm: z.boolean().default(true),
  intent: z.string().min(1),
  evidence_requirement: z.object({
    artifact: z.string().min(1),
    collector: Collector,
  }),
  test_requirement: z.object({
    attack_class: z.array(AttackClass).default([]),
    plane_a: z.boolean().default(false),
  }),
  status_rule: z.string().min(1),
})
export type ControlEntry = z.infer<typeof ControlEntry>

export const Catalog = z.object({
  version: z.string().min(1),
  catalog: z.string().optional(),
  updated: z.string().optional(),
  owasp_asi_reference: z.record(z.string(), z.string()).optional(),
  aiuc1_domain_reference: z.record(z.string(), z.string()).optional(),
  controls: z.array(ControlEntry).min(1),
})
export type Catalog = z.infer<typeof Catalog>
