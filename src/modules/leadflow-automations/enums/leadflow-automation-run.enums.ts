/**
 * How a run was produced.
 *
 * Keeping simulation and execution in the same table but distinguished by mode
 * is deliberate: they share every field, and conflating them is what would let
 * the UI report "last execution" for something that never touched a lead. No
 * run may be `Live` until a runtime exists.
 */
export enum LeadFlowAutomationRunMode {
  /** Evaluated with zero side effects, on demand, by an operator. */
  DryRun = 'dry_run',
  /** Produced by the execution engine. Unreachable until the engine exists. */
  Live = 'live',
}

export enum LeadFlowAutomationRunStatus {
  /** Created, not yet evaluated. */
  Pending = 'pending',
  Running = 'running',
  /** Finished and the automation would act (or did act). */
  Succeeded = 'succeeded',
  /** Finished and the automation deliberately did nothing. Not an error. */
  Skipped = 'skipped',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

/**
 * Why a run did not act. Separating "the conditions said no" from "something
 * broke" is what keeps the health signal meaningful — a follow-up that
 * correctly stopped because the lead replied is a success of the design, not a
 * failure to investigate.
 */
export enum LeadFlowAutomationSkipReason {
  BlockedByDependency = 'blocked_by_dependency',
  NotActive = 'not_active',
  IncompleteConfiguration = 'incomplete_configuration',
  ConditionNotMet = 'condition_not_met',
  OutsideBusinessHours = 'outside_business_hours',
  LeadReplied = 'lead_replied',
  HandoffInProgress = 'handoff_in_progress',
  AttemptLimitReached = 'attempt_limit_reached',
  CooldownActive = 'cooldown_active',
  ScoreBelowThreshold = 'score_below_threshold',
  UnsupportedBusinessMode = 'unsupported_business_mode',
}

/** Whether a failed attempt is worth retrying. */
export enum LeadFlowAutomationErrorClass {
  Transient = 'transient',
  Permanent = 'permanent',
}

export enum LeadFlowAutomationAttemptStatus {
  Succeeded = 'succeeded',
  Skipped = 'skipped',
  Failed = 'failed',
  /** Planned but not carried out, because this is a simulation. */
  Simulated = 'simulated',
}
