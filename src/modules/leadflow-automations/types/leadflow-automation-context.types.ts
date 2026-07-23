import type { LeadFlowAutomationDependency } from '../enums/leadflow-automation-dependency.enum';

/**
 * Signals a condition can be evaluated against.
 *
 * Named separately from the evaluation context shape because a signal is a
 * *contract*: it has an owning domain, a subject it is about, and a platform
 * dependency that must exist before anyone can read it. The evaluation context
 * is merely the resolved values.
 */
export enum LeadFlowAutomationContextSignal {
  LeadScore = 'lead_score',
  LeadReplied = 'lead_replied',
  HandoffActive = 'handoff_active',
  InsideBusinessHours = 'inside_business_hours',
  AttemptsSoFar = 'attempts_so_far',
  HoursSinceLastRun = 'hours_since_last_run',
  MatchedKeywords = 'matched_keywords',
  MatchedIntents = 'matched_intents',
  PresentFields = 'present_fields',
}

/**
 * What a signal is about. Resolution starts from the delivery envelope, which
 * already names one subject — so establishing these costs no query.
 */
export type LeadFlowAutomationContextSubject =
  | 'inbox_conversation'
  | 'crm_opportunity'
  /** The workspace itself (settings, business hours). */
  | 'workspace'
  /** The automation's own run history. Not a cross-domain read. */
  | 'automation';

/**
 * Where a resolved value came from.
 *
 * Provenance is recorded per signal because a verdict assembled from
 * assumptions must never be readable as one assembled from observation. The
 * three non-canonical origins are all deliberately distinguishable.
 */
export type LeadFlowAutomationSignalOrigin =
  /** Read directly off the delivered event envelope or payload. */
  | 'from_event'
  /** Supplied by an operator exploring a hypothetical in a simulation. */
  | 'operator'
  /**
   * The simulator's stand-in for a value the operator left blank. Valid only in
   * a dry-run, which is declared hypothetical; never valid for a real trigger.
   */
  | 'simulated_default'
  /** Loaded from the owning domain's canonical state. */
  | 'canonical_read';

/**
 * Why a required signal could not be established.
 *
 * These are not interchangeable, and collapsing them would hide the difference
 * between work that is merely pending and a capability the platform does not
 * have. Each maps onto a run skip reason of the same name.
 */
export type LeadFlowAutomationContextGap =
  /** The signal's subject or value is not reachable from what was delivered. */
  | 'missing_context'
  /** Two sources named different subjects; picking one would be a guess. */
  | 'ambiguous_context'
  /** The event is old enough that current state may not reflect it. */
  | 'stale_context'
  /** No platform capability produces this signal at all yet. */
  | 'dependency_unavailable';

/**
 * How long after an event a read of current state is still considered to
 * describe the situation that fired the trigger.
 *
 * A delivery that waited longer than this may have been overtaken: the lead
 * replied, the opportunity moved, the conversation closed. Acting on it would
 * be acting on a stale premise, so the verdict says so rather than pretending
 * the delay did not happen.
 */
export const LEADFLOW_AUTOMATION_CONTEXT_MAX_EVENT_AGE_MS = 15 * 60 * 1000;

/**
 * Version of the context snapshot format persisted on a run.
 *
 * Bumped whenever the recorded shape changes, so a stored verdict can always be
 * re-read under the rules that produced it instead of being reinterpreted by
 * whatever the current code happens to expect.
 */
export const LEADFLOW_AUTOMATION_CONTEXT_SCHEMA_VERSION = 1;

export interface LeadFlowAutomationResolvedSignal {
  origin: LeadFlowAutomationSignalOrigin;
  value: unknown;
}

export interface LeadFlowAutomationContextGapRecord {
  signal: LeadFlowAutomationContextSignal;
  gap: LeadFlowAutomationContextGap;
  /** Business-facing explanation, safe to show an operator. */
  detail: string;
  /** Set only when the gap is `dependency_unavailable`. */
  dependency: LeadFlowAutomationDependency | null;
}

/** Cost of assembling the context, recorded so the coupling stays measurable. */
export interface LeadFlowAutomationContextCost {
  /** Canonical reads issued. Zero while resolution is envelope-only. */
  queryCount: number;
  durationMs: number;
  /** Per-source breakdown, empty until loaders exist. */
  sources: Array<{ source: string; queryCount: number; durationMs: number }>;
}

/**
 * Immutable record of exactly what a verdict was computed from.
 *
 * Persisted on the run so a decision stays explainable after the fact: which
 * signals the configuration actually required, which were established and from
 * where, and which were not — with the reason. Without this a stored verdict is
 * an opinion with no audit trail.
 */
export interface LeadFlowAutomationContextSnapshot {
  schemaVersion: number;
  capturedAt: string;
  /** Age of the event when the context was assembled. Null for dry-runs. */
  eventAgeMs: number | null;
  subjects: Partial<Record<LeadFlowAutomationContextSubject, string>>;
  /** Signals this automation's published configuration actually needs. */
  required: LeadFlowAutomationContextSignal[];
  resolved: Partial<
    Record<LeadFlowAutomationContextSignal, LeadFlowAutomationResolvedSignal>
  >;
  gaps: LeadFlowAutomationContextGapRecord[];
  cost: LeadFlowAutomationContextCost;
}

export type LeadFlowAutomationContextGapMap = Partial<
  Record<LeadFlowAutomationContextSignal, LeadFlowAutomationContextGapRecord>
>;
