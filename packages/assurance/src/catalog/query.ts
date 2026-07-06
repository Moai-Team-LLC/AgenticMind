/**
 * Control Catalog query API (FR-7).
 *
 * Lookups over a validated catalog: by domain, by OWASP ASI, by collector type, by scope, and
 * whether a control requires a Plane-A test. Pure functions over the in-memory model.
 */
import type {
  Aiuc1Domain,
  Catalog,
  Collector,
  ControlEntry,
  ControlScope,
  OwaspAsi,
} from "./schema"

export function findControl(catalog: Catalog, id: string): ControlEntry | undefined {
  return catalog.controls.find((c) => c.id === id)
}

export function byDomain(catalog: Catalog, domain: Aiuc1Domain): ControlEntry[] {
  return catalog.controls.filter((c) => c.aiuc1_domain === domain)
}

export function byAsi(catalog: Catalog, asi: OwaspAsi): ControlEntry[] {
  return catalog.controls.filter((c) => c.owasp_asi.includes(asi))
}

export function byCollector(catalog: Catalog, collector: Collector): ControlEntry[] {
  return catalog.controls.filter((c) => c.evidence_requirement.collector === collector)
}

export function byScope(catalog: Catalog, scope: ControlScope): ControlEntry[] {
  return catalog.controls.filter((c) => c.scope === scope)
}

/** Controls that a Plane-A attack validates (plane_a true and at least one attack class). */
export function requiringPlaneATest(catalog: Catalog): ControlEntry[] {
  return catalog.controls.filter(
    (c) => c.test_requirement.plane_a && c.test_requirement.attack_class.length > 0,
  )
}

/** All OWASP ASI ids referenced anywhere in the catalog. */
export function referencedAsi(catalog: Catalog): OwaspAsi[] {
  const seen = new Set<OwaspAsi>()
  for (const c of catalog.controls) for (const a of c.owasp_asi) seen.add(a)
  return [...seen].toSorted()
}
