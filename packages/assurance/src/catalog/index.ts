/** Control Catalog subsystem (FR-7): schema + loader + query. */
export {
  Aiuc1Domain,
  AttackClass,
  Catalog,
  Collector,
  ControlEntry,
  ControlScope,
  OwaspAsi,
} from "./schema"
export {
  loadBundledCatalog,
  loadCatalog,
  parseCatalog,
  type CatalogError,
  type CatalogIssue,
} from "./load"
export {
  byAsi,
  byCollector,
  byDomain,
  byScope,
  findControl,
  referencedAsi,
  requiringPlaneATest,
} from "./query"
