import { Injectable } from '@nestjs/common';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import {
  LEADFLOW_AUTOMATION_CONTEXT_SIGNAL_SPECS,
  requiredContextSignals,
} from '../catalog/automation-context-requirements.catalog';
import { isDependencySatisfied } from '../catalog/automation-dependencies.registry';
import { LEADFLOW_AUTOMATION_DEPENDENCY_LABELS } from '../enums/leadflow-automation-dependency.enum';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import {
  LEADFLOW_AUTOMATION_CONTEXT_MAX_EVENT_AGE_MS,
  LEADFLOW_AUTOMATION_CONTEXT_SCHEMA_VERSION,
  LeadFlowAutomationContextSignal,
  type LeadFlowAutomationContextGap,
  type LeadFlowAutomationContextGapMap,
  type LeadFlowAutomationContextGapRecord,
  type LeadFlowAutomationContextSnapshot,
  type LeadFlowAutomationContextSubject,
  type LeadFlowAutomationSignalOrigin,
} from '../types/leadflow-automation-context.types';
import type { LeadFlowAutomationEvaluationContext } from './leadflow-automation-evaluation.service';

export interface LeadFlowAutomationContextResolution {
  snapshot: LeadFlowAutomationContextSnapshot;
  /** Only the signals that were actually established. */
  context: LeadFlowAutomationEvaluationContext;
  gaps: LeadFlowAutomationContextGapMap;
}

/**
 * Values an operator may assert while exploring a simulation.
 *
 * Separate from the evaluation context because these are declared hypotheses,
 * not observations, and the distinction is recorded on the run.
 */
export type LeadFlowAutomationSimulationInput =
  LeadFlowAutomationEvaluationContext;

/**
 * The simulator's stand-in values for signals an operator left blank.
 *
 * Only signals whose real value the platform *can* observe appear here. A
 * signal with no canonical source must never acquire a value this way — that is
 * how a threshold ends up silently satisfying itself.
 */
const SIMULATED_DEFAULTS: Partial<
  Record<LeadFlowAutomationContextSignal, unknown>
> = {
  [LeadFlowAutomationContextSignal.LeadReplied]: false,
  [LeadFlowAutomationContextSignal.HandoffActive]: false,
  [LeadFlowAutomationContextSignal.InsideBusinessHours]: true,
  [LeadFlowAutomationContextSignal.AttemptsSoFar]: 0,
  [LeadFlowAutomationContextSignal.HoursSinceLastRun]: 24 * 365,
};

/** Most severe first: the reason reported is the one that blocks hardest. */
const GAP_PRECEDENCE: LeadFlowAutomationContextGap[] = [
  'dependency_unavailable',
  'ambiguous_context',
  'stale_context',
  'missing_context',
];

/**
 * Establishes what a verdict may be computed from, and records what it may not.
 *
 * Resolution is demand-driven: only the signals the published configuration
 * actually consults are considered, and each one is either established from a
 * declared source or recorded as an explicit gap. Nothing is defaulted into
 * existence — a signal the platform cannot observe stays unresolved, and the
 * evaluator refuses to let a condition depending on it pass.
 *
 * This pass performs no cross-domain reads at all. Subjects come from the
 * delivery envelope, which already names the aggregate the event concerns, so
 * deciding *whether* a read would even be needed costs nothing. Batched
 * canonical loaders attach here later, behind the same gap vocabulary.
 */
@Injectable()
export class LeadFlowAutomationContextService {
  /**
   * Context for a real delivered trigger.
   *
   * Signals the event itself evidences are established from it. Everything else
   * requires reading canonical state, which this pass does not do, so it is
   * reported as a gap rather than guessed.
   */
  resolveFromEnvelope(
    automation: LeadFlowAutomationEntity,
    delivery: LeadFlowEventDeliveryEntity,
    now: Date = new Date(),
  ): LeadFlowAutomationContextResolution {
    const startedAt = Date.now();
    const required = requiredContextSignals(automation);
    const { subjects, ambiguous } = this.resolveSubjects(delivery);
    const eventAgeMs = Math.max(
      0,
      now.getTime() - delivery.occurredAt.getTime(),
    );
    const stale = eventAgeMs > LEADFLOW_AUTOMATION_CONTEXT_MAX_EVENT_AGE_MS;

    const context: LeadFlowAutomationEvaluationContext = {};
    const resolved: LeadFlowAutomationContextSnapshot['resolved'] = {};
    const gaps: LeadFlowAutomationContextGapRecord[] = [];

    for (const signal of required) {
      const spec = LEADFLOW_AUTOMATION_CONTEXT_SIGNAL_SPECS[signal];

      if (spec.dependency && !isDependencySatisfied(spec.dependency)) {
        gaps.push({
          signal,
          gap: 'dependency_unavailable',
          detail: LEADFLOW_AUTOMATION_DEPENDENCY_LABELS[spec.dependency],
          dependency: spec.dependency,
        });
        continue;
      }

      // Signals the event itself is evidence for need no lookup, and staleness
      // does not weaken them: the event reports something that did happen.
      const fromEvent = this.signalFromEvent(signal, delivery);
      if (fromEvent !== undefined) {
        this.assign(context, signal, fromEvent);
        resolved[signal] = { origin: 'from_event', value: fromEvent };
        continue;
      }

      gaps.push(
        this.canonicalGap(signal, spec.subject, subjects, ambiguous, stale),
      );
    }

    return this.buildResolution({
      required,
      subjects,
      resolved,
      gaps,
      context,
      capturedAt: now,
      eventAgeMs,
      durationMs: Date.now() - startedAt,
    });
  }

  /**
   * Context for an operator-driven simulation.
   *
   * A dry-run is explicitly hypothetical, so an operator may assert values the
   * platform cannot yet observe — but only by stating them. Absence never
   * becomes a value: a blank field for a signal with no canonical source stays
   * a gap, so a simulation can no longer satisfy a threshold by omission.
   */
  resolveForSimulation(
    automation: LeadFlowAutomationEntity,
    input: LeadFlowAutomationSimulationInput = {},
    now: Date = new Date(),
  ): LeadFlowAutomationContextResolution {
    const startedAt = Date.now();
    const required = requiredContextSignals(automation);

    const context: LeadFlowAutomationEvaluationContext = {};
    const resolved: LeadFlowAutomationContextSnapshot['resolved'] = {};
    const gaps: LeadFlowAutomationContextGapRecord[] = [];

    for (const signal of required) {
      const spec = LEADFLOW_AUTOMATION_CONTEXT_SIGNAL_SPECS[signal];

      // A missing capability blocks the simulator too. Letting an operator
      // assert a value the platform cannot produce would make the dry-run
      // answer a question the live automation can never answer, and the
      // configuration would look validated when it is not.
      if (spec.dependency && !isDependencySatisfied(spec.dependency)) {
        gaps.push({
          signal,
          gap: 'dependency_unavailable',
          detail: LEADFLOW_AUTOMATION_DEPENDENCY_LABELS[spec.dependency],
          dependency: spec.dependency,
        });
        continue;
      }

      const asserted = input[spec.contextKey];
      if (asserted !== undefined) {
        this.assign(context, signal, asserted);
        resolved[signal] = { origin: 'operator', value: asserted };
        continue;
      }

      const fallback = SIMULATED_DEFAULTS[signal];
      if (fallback !== undefined) {
        this.assign(context, signal, fallback);
        resolved[signal] = { origin: 'simulated_default', value: fallback };
        continue;
      }

      gaps.push({
        signal,
        gap: 'missing_context',
        detail: `${spec.label}: informe um valor para simular esta condição.`,
        dependency: null,
      });
    }

    return this.buildResolution({
      required,
      subjects: {},
      resolved,
      gaps,
      context,
      capturedAt: now,
      eventAgeMs: null,
      durationMs: Date.now() - startedAt,
    });
  }

  /**
   * Subjects named by the delivery envelope.
   *
   * The envelope's aggregate is authoritative. A payload reference to the same
   * kind of subject must agree with it — when it does not, neither is trusted,
   * because choosing between them would be a guess about which domain wrote the
   * event correctly. A reference to a *different* kind of subject (an
   * opportunity's linked conversation) is accepted: it was written by the same
   * domain in the same transaction as the event.
   */
  private resolveSubjects(delivery: LeadFlowEventDeliveryEntity): {
    subjects: Partial<Record<LeadFlowAutomationContextSubject, string>>;
    ambiguous: Set<LeadFlowAutomationContextSubject>;
  } {
    const payload = delivery.payload ?? {};
    const subjects: Partial<Record<LeadFlowAutomationContextSubject, string>> =
      {
        workspace: delivery.workspaceId,
        automation: delivery.workspaceId,
      };
    const ambiguous = new Set<LeadFlowAutomationContextSubject>();

    const claim = (
      kind: Exclude<
        LeadFlowAutomationContextSubject,
        'workspace' | 'automation'
      >,
      envelopeId: string | null,
      payloadId: unknown,
    ): void => {
      const fromPayload =
        typeof payloadId === 'string' && payloadId !== '' ? payloadId : null;
      if (envelopeId && fromPayload && envelopeId !== fromPayload) {
        ambiguous.add(kind);
        return;
      }
      const resolved = envelopeId ?? fromPayload;
      if (resolved) subjects[kind] = resolved;
    };

    const isConversation = delivery.aggregateType === 'inbox_conversation';
    const isOpportunity = delivery.aggregateType === 'crm_opportunity';

    claim(
      'inbox_conversation',
      isConversation ? delivery.aggregateId : null,
      payload.conversationId,
    );
    claim(
      'crm_opportunity',
      isOpportunity ? delivery.aggregateId : null,
      payload.opportunityId,
    );

    return { subjects, ambiguous };
  }

  /** Values the delivered event is itself evidence for. */
  private signalFromEvent(
    signal: LeadFlowAutomationContextSignal,
    delivery: LeadFlowEventDeliveryEntity,
  ): unknown {
    if (
      signal === LeadFlowAutomationContextSignal.LeadReplied &&
      delivery.eventName === 'leadflow.inbox.conversation.message.received'
    ) {
      return true;
    }
    if (
      signal === LeadFlowAutomationContextSignal.HandoffActive &&
      delivery.eventName.startsWith(
        'leadflow.inbox.conversation.handoff.requested',
      )
    ) {
      return true;
    }
    return undefined;
  }

  /** Why a signal needing canonical state could not be established. */
  private canonicalGap(
    signal: LeadFlowAutomationContextSignal,
    subject: LeadFlowAutomationContextSubject,
    subjects: Partial<Record<LeadFlowAutomationContextSubject, string>>,
    ambiguous: Set<LeadFlowAutomationContextSubject>,
    stale: boolean,
  ): LeadFlowAutomationContextGapRecord {
    const spec = LEADFLOW_AUTOMATION_CONTEXT_SIGNAL_SPECS[signal];

    if (ambiguous.has(subject)) {
      return {
        signal,
        gap: 'ambiguous_context',
        detail: `${spec.label}: o evento aponta para mais de um registro e nenhum pôde ser escolhido com segurança.`,
        dependency: null,
      };
    }
    if (!subjects[subject]) {
      return {
        signal,
        gap: 'missing_context',
        detail: `${spec.label}: o evento não identifica o registro necessário para consultar este dado.`,
        dependency: null,
      };
    }
    if (stale) {
      return {
        signal,
        gap: 'stale_context',
        detail: `${spec.label}: o evento demorou demais para ser processado e o estado atual pode não descrever o momento em que ele ocorreu.`,
        dependency: null,
      };
    }
    return {
      signal,
      gap: 'missing_context',
      detail: `${spec.label}: a leitura canônica deste dado ainda não está disponível.`,
      dependency: null,
    };
  }

  private assign(
    context: LeadFlowAutomationEvaluationContext,
    signal: LeadFlowAutomationContextSignal,
    value: unknown,
  ): void {
    const key = LEADFLOW_AUTOMATION_CONTEXT_SIGNAL_SPECS[signal].contextKey;
    Object.assign(context, { [key]: value });
  }

  private buildResolution(input: {
    required: LeadFlowAutomationContextSignal[];
    subjects: Partial<Record<LeadFlowAutomationContextSubject, string>>;
    resolved: LeadFlowAutomationContextSnapshot['resolved'];
    gaps: LeadFlowAutomationContextGapRecord[];
    context: LeadFlowAutomationEvaluationContext;
    capturedAt: Date;
    eventAgeMs: number | null;
    durationMs: number;
  }): LeadFlowAutomationContextResolution {
    const gapMap: LeadFlowAutomationContextGapMap = {};
    for (const record of input.gaps) {
      const current = gapMap[record.signal];
      // A signal can attract more than one gap; report the hardest blocker.
      if (!current || rank(record.gap) < rank(current.gap)) {
        gapMap[record.signal] = record;
      }
    }

    return {
      snapshot: {
        schemaVersion: LEADFLOW_AUTOMATION_CONTEXT_SCHEMA_VERSION,
        capturedAt: input.capturedAt.toISOString(),
        eventAgeMs: input.eventAgeMs,
        subjects: input.subjects,
        required: input.required,
        resolved: input.resolved,
        gaps: Object.values(gapMap),
        cost: {
          // Envelope-only resolution issues no reads. Loaders report here.
          queryCount: 0,
          durationMs: input.durationMs,
          sources: [],
        },
      },
      context: input.context,
      gaps: gapMap,
    };
  }
}

function rank(gap: LeadFlowAutomationContextGap): number {
  return GAP_PRECEDENCE.indexOf(gap);
}

/** Origins that mean the value was observed rather than assumed. */
export const OBSERVED_ORIGINS: readonly LeadFlowAutomationSignalOrigin[] = [
  'from_event',
  'canonical_read',
];
