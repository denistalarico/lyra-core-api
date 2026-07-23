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
  /**
   * Produced by a real delivered trigger and evaluated against real state, but
   * carrying out no effect because no productive executor is registered.
   *
   * This is the honest middle ground the platform actually occupies: triggers
   * arrive for real, the decision is real, and nothing happens. Folding it into
   * `Live` would claim effects that never occurred; folding it into `DryRun`
   * would claim an operator asked for it.
   */
  Shadow = 'shadow',
  /** Produced by the execution engine with at least one confirmed effect. */
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
  /** A condition was evaluated against a known value and said no. */
  ConditionNotMet = 'condition_not_met',
  /**
   * A signal the configuration requires was not established, so no condition
   * depending on it could be evaluated. Deliberately not the same as
   * `ConditionNotMet`: "I checked and the answer is no" and "I could not check"
   * are different facts, and only the first is a working automation.
   */
  MissingContext = 'missing_context',
  /** Sources disagreed about which subject the event concerns. */
  AmbiguousContext = 'ambiguous_context',
  /** The event waited long enough that current state may not describe it. */
  StaleContext = 'stale_context',
  /** No platform capability produces the required signal at all. */
  DependencyUnavailable = 'dependency_unavailable',
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
  Running = 'running',
  Succeeded = 'succeeded',
  Skipped = 'skipped',
  Failed = 'failed',
  /** Planned but not carried out, because this is a simulation. */
  Simulated = 'simulated',
}
