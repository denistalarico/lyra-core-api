import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';

/**
 * The time axis of LeadFlow: a durable, idempotent way to say "do this later".
 *
 * WHY THIS EXISTS (decision D2, see docs/architecture/leadflow-functional-readiness-audit.md §16):
 * every time-based automation — follow-up 24h/D+3/D+7, reactivation, appointment
 * reminder/confirmation/no-show, daily summary — needs something to fire at a
 * future instant. The platform has a mature Postgres event fabric (outbox +
 * fan-out trigger + `@Interval` pollers) but NO engine for the clock. Temporal is
 * absent from the environment and, for the current single-node scale, would cost
 * more to operate than it returns.
 *
 * The approved decision: implement this port with a **durable PostgreSQL
 * scheduler** for the MVP (a `leadflow_scheduled_timers` table drained by a
 * poller, mirroring the existing outbox pattern), behind THIS abstract contract
 * so a future Temporal-backed implementation can replace it without touching a
 * single consumer. Temporal is reconsidered only when genuinely long/complex
 * workflows justify operating it.
 *
 * THIS FILE IS CONTRACT-ONLY. It declares the port and its shapes; it wires no
 * provider, imports no runtime, and is imported by nobody yet. The concrete
 * Postgres implementation (and its migration) land in the follow-up phase
 * ("SchedulerRuntime + follow-up"), not here — Phase 0 only fixes the shape so
 * later phases have a stable extension point.
 *
 * Invariants every implementation MUST uphold:
 *  - **Idempotent by `timerKey`** within `dedupeScope`: scheduling the same key
 *    twice yields one timer, never two. This is what makes a retried scheduling
 *    call safe.
 *  - **Tenant/workspace isolation**: a timer is always scoped to one
 *    tenant+workspace; a fire envelope never crosses that boundary.
 *  - **Durable at-least-once fire**: a scheduled timer survives process restarts
 *    and fires at least once; consumers must themselves be idempotent on
 *    `timerId`/`timerKey` (the same discipline the automation executors already
 *    follow via `idempotencyKey`).
 *  - **No effect here**: firing hands a {@link TimerFireEnvelope} to a consumer;
 *    the scheduler never performs a domain effect itself.
 */

/** DI token for the port, so a provider can be bound in a later phase. */
export const SCHEDULER_RUNTIME = Symbol('LEADFLOW_SCHEDULER_RUNTIME');

/**
 * Why a timer exists. Coarse and stable — used for observability and for routing
 * a fire to the right consumer alongside {@link ScheduleTimerRequest.consumerKey}.
 */
export type ScheduledTimerPurpose =
  | 'automation_followup'
  | 'automation_reactivation'
  | 'automation_daily_summary'
  | 'appointment_reminder'
  | 'appointment_confirmation'
  | 'appointment_no_show_check'
  | 'generic';

export type ScheduledTimerStatus =
  /** Persisted and waiting for its fire instant. */
  | 'scheduled'
  /** Fire instant reached and the envelope was delivered to the consumer. */
  | 'fired'
  /** Cancelled before firing (e.g. the lead replied, handoff happened). */
  | 'cancelled'
  /** Replaced by a newer schedule for the same key (reschedule). */
  | 'superseded';

export interface ScheduleTimerRequest {
  tenantId: string;
  workspaceId: string;
  /**
   * Idempotency key for the timer within {@link dedupeScope}. Scheduling the same
   * key again is a no-op that returns the existing handle, never a second timer.
   */
  timerKey: string;
  /**
   * Optional namespace for {@link timerKey} uniqueness (e.g. an automation id or
   * a follow-up window). Defaults to the whole workspace when omitted.
   */
  dedupeScope?: string;
  /** When the timer should fire. ISO-8601 UTC. */
  fireAt: string;
  purpose: ScheduledTimerPurpose;
  /**
   * Which consumer receives the fire envelope. Mirrors the `consumer_key` of the
   * existing event fan-out so the same per-consumer draining discipline applies.
   */
  consumerKey: string;
  /** Opaque, already-validated input handed back verbatim on fire. Never secrets. */
  payload: LeadFlowJsonObject;
  /** Durable-delivery attempt cap at fire time. Implementation picks a safe default. */
  maxAttempts?: number;
}

export interface CancelTimerRequest {
  tenantId: string;
  workspaceId: string;
  timerKey: string;
  dedupeScope?: string;
}

/** What a scheduling call returns — enough to observe or cancel the timer later. */
export interface ScheduledTimerHandle {
  timerId: string;
  timerKey: string;
  status: ScheduledTimerStatus;
  fireAt: string;
}

/**
 * What a consumer receives when a timer fires. The consumer re-reads canonical
 * state and decides what to do — exactly like an automation executor revalidates
 * before acting — so a fire that is no longer relevant (lead replied, handoff
 * taken) results in a clean skip, not a wrong effect.
 */
export interface TimerFireEnvelope {
  timerId: string;
  timerKey: string;
  tenantId: string;
  workspaceId: string;
  purpose: ScheduledTimerPurpose;
  consumerKey: string;
  payload: LeadFlowJsonObject;
  /** When the timer was originally scheduled. ISO-8601 UTC. */
  scheduledAt: string;
  /** When it actually fired. ISO-8601 UTC. */
  firedAt: string;
  /** 1-based delivery attempt for this fire. */
  attempt: number;
}

/**
 * The single port through which LeadFlow schedules future work.
 *
 * Consumers depend on this interface (via {@link SCHEDULER_RUNTIME}), never on a
 * concrete engine, so the MVP Postgres implementation and any future Temporal
 * one are interchangeable.
 */
export interface SchedulerRuntime {
  /**
   * Schedules a timer. Idempotent on {@link ScheduleTimerRequest.timerKey} within
   * its `dedupeScope`: a repeated call returns the existing handle.
   */
  schedule(request: ScheduleTimerRequest): Promise<ScheduledTimerHandle>;

  /** Cancels a not-yet-fired timer by key. A no-op if none matches. */
  cancel(request: CancelTimerRequest): Promise<void>;

  /**
   * Moves an existing timer to a new `fireAt`, superseding the previous one for
   * the same key. Equivalent to cancel + schedule, atomically.
   */
  reschedule(request: ScheduleTimerRequest): Promise<ScheduledTimerHandle>;
}
