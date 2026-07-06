/**
 * Remediation subsystem (FR-11): the autonomy ladder + the Cycle-of-Trust guard (structural-config
 * only). L2 = triage (propose only); L3 = judge gate -> HITL approval -> apply -> revert, recorded
 * in an immutable, revertable ledger.
 */
export * from "./proposal"
export * from "./guard"
export * from "./triage"
export * from "./judge"
// The raw `transition` mutator is deliberately NOT re-exported — consumers must go through
// approveRemediation / applyRemediation / revertRemediation so the HITL + actor invariants hold.
export type {
  AppliedEdit,
  LedgerEvent,
  RemediationLedgerEntry,
  RemediationState,
  TransitionError,
} from "./ledger"
export * from "./apply"
export * from "./revert"
