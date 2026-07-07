/** Gap-analysis subsystem (FR-8): ingest Core findings, score G/Y/R, remediation plan. */
export {
  CoreAttack,
  CoreFinding,
  CoreFlow,
  CoreOutcome,
  CoreReport,
  ingestCoreJson,
  ingestCoreReport,
  type IngestError,
} from "./ingest"
export { scoreCatalog, scoreControl, statusCounts } from "./score"
export { remediationPlan, type RemediationItem } from "./plan"
