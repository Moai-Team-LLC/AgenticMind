/**
 * AAL Evidence — compliance & evidence layer over AAL Core.
 *
 * Consumes AAL Core's structured findings, maps target facts to a control catalog
 * (AIUC-1 / OWASP ASI / ISO 42001), harvests evidence from AgenticMind's existing artifacts,
 * scores every control Green/Yellow/Red, and emits a continuously-refreshable auditor bundle.
 *
 * Staging note: this package is destined for `AgenticMind/packages/assurance` (@agenticmind/assurance).
 * Its scoring/catalog/bundle logic is framework-neutral and runs standalone; the native collectors
 * take engine rows as input so the mapping is tested here and only the Drizzle query is wired in-repo.
 */
export const AAL_EVIDENCE_VERSION = "0.1.0" as const

export {
  Aiuc1Domain,
  AttackClass,
  byAsi,
  byCollector,
  byDomain,
  byScope,
  Catalog,
  type CatalogError,
  type CatalogIssue,
  Collector,
  ControlEntry,
  ControlScope,
  findControl,
  loadBundledCatalog,
  loadCatalog,
  OwaspAsi,
  parseCatalog,
  referencedAsi,
  requiringPlaneATest,
} from "./catalog"
export {
  type AskTelemetryRow,
  collectFromEngine,
  collectFromOtelSpans,
  collectManual,
  collectNative,
  type CollectFromEngineProps,
  collectToolAuditEvents,
  computeCoverage,
  type ControlStatus,
  type Coverage,
  type EngineRows,
  type EvidenceRecord,
  type GuardEventRow,
  isGenAiSpan,
  type McpTokenRow,
  OtelGenAiSpan,
  type Status,
  type ToolAuditEventRow,
} from "./evidence"
export {
  CoreAttack,
  CoreFinding,
  CoreFlow,
  CoreOutcome,
  CoreReport,
  type IngestError,
  ingestCoreJson,
  ingestCoreReport,
  remediationPlan,
  type RemediationItem,
  scoreCatalog,
  scoreControl,
  statusCounts,
} from "./gap"
export {
  assembleBundle,
  type AuditorBundle,
  bundleToJson,
  bundleToMarkdown,
  type ControlSnapshot,
  coverageLine,
  diffBundles,
  diffSnapshots,
  type DriftAlert,
  type DriftReport,
  evaluateDrift,
  type ScoredControl,
  snapshotBundle,
  type StatusChange,
} from "./bundle"
export {
  type AppliedEdit,
  type ApplyError,
  applyRemediation,
  approveRemediation,
  buildJudgePrompt,
  declineRemediation,
  enforceCycleOfTrust,
  type FixProposal,
  type GateDecision,
  type GateOutcome,
  gateProposal,
  type GuardResult,
  type GuardViolation,
  invertEdit,
  type LedgerEvent,
  makeEngineJudge,
  openRemediation,
  type ProposedEdit,
  REMEDIATION_JUDGE_SYSTEM,
  type RemediationJudge,
  type RemediationJudgeResult,
  type RemediationLedgerEntry,
  type RemediationState,
  type RemediationVerdict,
  revertRemediation,
  type RevertError,
  type StructuralTarget,
  triageFindings,
  type TransitionError,
} from "./remediate"
export * from "./notify"
