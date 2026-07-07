/**
 * Remediation subsystem (FR-11): the autonomy ladder + the Cycle-of-Trust guard (structural-config
 * only). L2 = triage (propose only); L3 = judge gate -> HITL approval -> apply -> revert, recorded
 * in an immutable, revertable ledger.
 */
export type {
  FixProposal,
  GuardResult,
  GuardViolation,
  ProposedEdit,
  StructuralTarget,
} from "./proposal"
export { enforceCycleOfTrust } from "./guard"
export { triageFindings } from "./triage"
export {
  buildJudgePrompt,
  gateProposal,
  type GateDecision,
  type GateOutcome,
  type RemediationJudge,
  type RemediationJudgeResult,
  type RemediationVerdict,
} from "./judge"
export { makeEngineJudge, REMEDIATION_JUDGE_SYSTEM } from "./engine-judge"
// The raw `transition` mutator is deliberately NOT re-exported — consumers must go through
// approveRemediation / applyRemediation / revertRemediation so the HITL + actor invariants hold.
export type {
  AppliedEdit,
  LedgerEvent,
  RemediationLedgerEntry,
  RemediationState,
  TransitionError,
} from "./ledger"
export {
  applyRemediation,
  approveRemediation,
  declineRemediation,
  openRemediation,
  type ApplyError,
} from "./apply"
export { invertEdit, revertRemediation, type RevertError } from "./revert"
