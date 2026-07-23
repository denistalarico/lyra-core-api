import type { LeadFlowAutomationDependency } from '../enums/leadflow-automation-dependency.enum';
import type { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import type {
  LeadFlowAutomationAction,
  LeadFlowJsonObject,
} from '../types/leadflow-automation.types';

/**
 * The single contract through which an automation may cause anything to happen
 * outside its own module.
 *
 * Automations owns *when* something should happen; every other domain owns
 * *what* happening means. Routing all effects through one typed port is what
 * keeps that boundary enforceable: there is exactly one place to audit for
 * direct cross-domain writes, and an executor that bypasses its owning domain's
 * canonical command is visible as an anomaly rather than buried in a service.
 *
 * No productive executor exists yet — see {@link UnavailableExecutor}.
 */

/**
 * The obligation to confirm the decision still holds before acting on it.
 *
 * A verdict is computed from state read at some earlier moment; by the time an
 * effect is requested that state may have moved — the lead replied, the
 * opportunity changed stage, a human took over. Carrying this on every request
 * makes the re-read impossible to forget: an executor receives the premise it
 * is expected to re-verify, not just the instruction.
 */
export interface AutomationEffectRevalidation {
  /** Format of the context snapshot the decision was computed from. */
  contextSchemaVersion: number;
  /** When that context was captured. */
  capturedAt: string;
  /** Subjects the decision was about, by kind. */
  subjects: Record<string, string>;
  /**
   * Version the target aggregate had when the decision was made, for domains
   * that expose optimistic concurrency. Null only when the target has none —
   * never as a way to opt out of the check.
   */
  expectedVersion: number | null;
}

export interface AutomationEffectRequest {
  tenantId: string;
  workspaceId: string;
  automationId: string;
  runId: string;
  attemptNumber: number;
  actionKey: LeadFlowAutomationAction | string;
  correlationId: string;
  /**
   * Per-effect key. Two attempts carrying the same key must produce one effect.
   * This is what makes a retry safe, so it is required rather than optional.
   */
  idempotencyKey: string;
  /**
   * Who the effect is attributed to in the owning domain.
   *
   * Required, not optional: an effect nobody can be held responsible for must
   * not be attempted at all. An executor that cannot resolve an actor fails
   * closed rather than acting as the system.
   */
  actorRef: string;
  /** Governing policy of the owning domain, resolved before the request. */
  policyRef: string;
  /** Action-specific input, already validated against the recipe schema. */
  payload: LeadFlowJsonObject;
  revalidation: AutomationEffectRevalidation;
}

export type AutomationEffectStatus =
  /** The owning domain acknowledged the effect. */
  | 'confirmed'
  /** Deliberately not carried out (policy, consent, window). Not an error. */
  | 'refused'
  /** Attempted and failed. See `errorClass` for whether a retry is worthwhile. */
  | 'failed'
  /** No executor is wired for this action yet. */
  | 'unavailable';

export interface AutomationEffectResult {
  status: AutomationEffectStatus;
  /**
   * True only when the owning domain confirmed the effect. A retry must never
   * replay an attempt whose effect was confirmed.
   */
  effectConfirmed: boolean;
  errorClass?: LeadFlowAutomationErrorClass;
  errorCode?: string;
  /** Sanitized. Never carries provider payloads or personal data. */
  errorMessage?: string;
  /** Opaque reference returned by the owning domain (message id, run id, …). */
  reference?: string | null;
}

/** Why an executor cannot run today. */
export type AutomationExecutorUnavailableReason =
  /** A platform capability this action needs does not exist yet. */
  | 'dependency_missing'
  /**
   * The capability exists, but the adapter from Automations to it has not been
   * built. Distinguished from the above because it is ordinary work rather than
   * a blocked dependency — it tells the team what is merely pending.
   */
  | 'not_implemented';

export interface AutomationExecutorAvailability {
  actionKey: string;
  available: boolean;
  reason: AutomationExecutorUnavailableReason | null;
  /** Set only when `reason` is `dependency_missing`. */
  dependency: LeadFlowAutomationDependency | null;
  /** Which domain owns the effect. Automations never owns one. */
  owningDomain: string;
  description: string;
}

export interface AutomationExecutor {
  readonly actionKey: LeadFlowAutomationAction | string;

  /** Static description of whether this executor can run, and why not. */
  availability(): AutomationExecutorAvailability;

  /**
   * Requests the effect from its owning domain.
   *
   * Implementations must be idempotent on `request.idempotencyKey`, and must
   * re-read canonical state before acting, refusing when it no longer matches
   * `request.revalidation`. The decision that produced this request was made
   * against a snapshot; acting without confirming it is acting on a premise
   * that may already be false.
   */
  execute(request: AutomationEffectRequest): Promise<AutomationEffectResult>;
}
