/** Auditor bundle subsystem (FR-10): assemble + export MD/JSON + drift. */
export { assembleBundle, type AuditorBundle, type ScoredControl } from "./build"
export { bundleToJson, bundleToMarkdown, coverageLine } from "./export"
export {
  diffBundles,
  diffSnapshots,
  evaluateDrift,
  snapshotBundle,
  type ControlSnapshot,
  type DriftAlert,
  type DriftReport,
  type StatusChange,
} from "./drift"
