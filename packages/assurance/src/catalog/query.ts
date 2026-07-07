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

export const findControl = (catalog: Catalog, id: string): ControlEntry | undefined =>
  catalog.controls.find((c) => c.id === id)

export const byDomain = (catalog: Catalog, domain: Aiuc1Domain): ControlEntry[] =>
  catalog.controls.filter((c) => c.aiuc1_domain === domain)

export const byAsi = (catalog: Catalog, asi: OwaspAsi): ControlEntry[] =>
  catalog.controls.filter((c) => c.owasp_asi.includes(asi))

export const byCollector = (catalog: Catalog, collector: Collector): ControlEntry[] =>
  catalog.controls.filter((c) => c.evidence_requirement.collector === collector)

export const byScope = (catalog: Catalog, scope: ControlScope): ControlEntry[] =>
  catalog.controls.filter((c) => c.scope === scope)

/** Controls that a Plane-A attack validates (plane_a true and at least one attack class). */
export const requiringPlaneATest = (catalog: Catalog): ControlEntry[] =>
  catalog.controls.filter(
    (c) => c.test_requirement.plane_a && c.test_requirement.attack_class.length > 0,
  )

/** All OWASP ASI ids referenced anywhere in the catalog. */
export const referencedAsi = (catalog: Catalog): OwaspAsi[] => {
  const seen = new Set<OwaspAsi>()
  for (const c of catalog.controls) {
    for (const a of c.owasp_asi) {
      seen.add(a)
    }
  }
  return [...seen].toSorted()
}
