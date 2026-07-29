import { LeadFlowAutomationDependency } from '../enums/leadflow-automation-dependency.enum';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import {
  LeadFlowAutomationContextSignal,
  type LeadFlowAutomationContextSubject,
} from '../types/leadflow-automation-context.types';
import type { LeadFlowAutomationEvaluationContext } from '../services/leadflow-automation-evaluation.service';

/**
 * What each signal needs in order to exist.
 *
 * `contextKey` is the bridge to the evaluation context, which stays camelCase
 * because it is the shape conditions are written against. `dependency` is the
 * platform capability that produces the signal — when it is unsatisfied the
 * signal cannot be established by any amount of reading, which is a different
 * failure from simply not having loaded it.
 */
export interface LeadFlowAutomationContextSignalSpec {
  signal: LeadFlowAutomationContextSignal;
  contextKey: keyof LeadFlowAutomationEvaluationContext;
  subject: LeadFlowAutomationContextSubject;
  /** Domain that owns the canonical value. Automations owns none of them. */
  owningDomain: string;
  dependency: LeadFlowAutomationDependency | null;
  /** Shown to an operator when the signal is missing. */
  label: string;
}

export const LEADFLOW_AUTOMATION_CONTEXT_SIGNAL_SPECS: Record<
  LeadFlowAutomationContextSignal,
  LeadFlowAutomationContextSignalSpec
> = {
  [LeadFlowAutomationContextSignal.LeadScore]: {
    signal: LeadFlowAutomationContextSignal.LeadScore,
    contextKey: 'leadScore',
    subject: 'crm_opportunity',
    owningDomain: 'leadflow_crm',
    // No column, no emitter, no policy: the platform cannot score a lead today.
    // Automations must never invent one — the CRM will own Lead Score V1.
    dependency: LeadFlowAutomationDependency.LeadScoreEngine,
    label: 'Pontuação do lead',
  },
  [LeadFlowAutomationContextSignal.LeadReplied]: {
    signal: LeadFlowAutomationContextSignal.LeadReplied,
    contextKey: 'leadReplied',
    subject: 'inbox_conversation',
    owningDomain: 'leadflow_inbox',
    dependency: null,
    label: 'Resposta do lead',
  },
  [LeadFlowAutomationContextSignal.HandoffActive]: {
    signal: LeadFlowAutomationContextSignal.HandoffActive,
    contextKey: 'handoffActive',
    subject: 'inbox_conversation',
    owningDomain: 'leadflow_inbox',
    dependency: null,
    label: 'Atendimento humano em curso',
  },
  [LeadFlowAutomationContextSignal.InsideBusinessHours]: {
    signal: LeadFlowAutomationContextSignal.InsideBusinessHours,
    contextKey: 'insideBusinessHours',
    subject: 'workspace',
    owningDomain: 'leadflow_inbox',
    dependency: null,
    label: 'Horário comercial',
  },
  [LeadFlowAutomationContextSignal.AttemptsSoFar]: {
    signal: LeadFlowAutomationContextSignal.AttemptsSoFar,
    contextKey: 'attemptsSoFar',
    subject: 'automation',
    owningDomain: 'leadflow_automations',
    dependency: null,
    label: 'Tentativas já feitas',
  },
  [LeadFlowAutomationContextSignal.HoursSinceLastRun]: {
    signal: LeadFlowAutomationContextSignal.HoursSinceLastRun,
    contextKey: 'hoursSinceLastRun',
    subject: 'automation',
    owningDomain: 'leadflow_automations',
    dependency: null,
    label: 'Tempo desde a última execução',
  },
  [LeadFlowAutomationContextSignal.MatchedKeywords]: {
    signal: LeadFlowAutomationContextSignal.MatchedKeywords,
    contextKey: 'matchedKeywords',
    subject: 'inbox_conversation',
    owningDomain: 'leadflow_inbox',
    dependency: null,
    label: 'Palavras-chave da mensagem',
  },
  [LeadFlowAutomationContextSignal.MatchedIntents]: {
    signal: LeadFlowAutomationContextSignal.MatchedIntents,
    contextKey: 'matchedIntents',
    subject: 'inbox_conversation',
    owningDomain: 'leadflow_agents',
    dependency: null,
    label: 'Intenção reconhecida',
  },
  [LeadFlowAutomationContextSignal.PresentFields]: {
    signal: LeadFlowAutomationContextSignal.PresentFields,
    contextKey: 'presentFields',
    subject: 'crm_opportunity',
    owningDomain: 'leadflow_crm',
    dependency: null,
    label: 'Campos preenchidos da oportunidade',
  },
  [LeadFlowAutomationContextSignal.AppointmentContext]: {
    signal: LeadFlowAutomationContextSignal.AppointmentContext,
    contextKey: 'appointmentContext',
    subject: 'scheduled_item',
    owningDomain: 'leadflow_calendar',
    dependency: LeadFlowAutomationDependency.AgendaDomain,
    label: 'Dados do compromisso',
  },
};

/**
 * Triggers whose subject is a commitment in the Agenda.
 *
 * Kept as data rather than a string prefix test because it is also the list the
 * evaluator uses to decide that an appointment context is mandatory: a trigger
 * that is added here starts requiring the guard in the same change.
 */
export const LEADFLOW_APPOINTMENT_TRIGGERS: ReadonlySet<string> = new Set([
  'appointment.created',
  'appointment.confirmation_pending',
  'appointment.no_show',
  'appointment.completed',
]);

/**
 * Which signals an automation's published configuration actually needs.
 *
 * Derived from the configuration rather than from the recipe: two instances of
 * the same recipe with different conditions require different context, and
 * loading a signal nobody asked about is exactly the indiscriminate coupling
 * this design exists to avoid. A signal appears here only when a condition or
 * limit would consult it.
 */
export function requiredContextSignals(
  automation: LeadFlowAutomationEntity,
): LeadFlowAutomationContextSignal[] {
  const conditions = automation.conditionConfig ?? {};
  const actions = automation.actionConfig ?? {};
  const schedule = automation.schedulePolicy ?? {};
  const required = new Set<LeadFlowAutomationContextSignal>();

  // Required by the trigger rather than by a condition: an agenda automation
  // says something about a specific commitment, so without that commitment
  // there is nothing for any condition to be about. Deriving it from the
  // published trigger keeps the rule config-driven — an instance configured
  // against another trigger never pays for this read.
  if (LEADFLOW_APPOINTMENT_TRIGGERS.has(automation.triggerConfig?.type ?? '')) {
    required.add(LeadFlowAutomationContextSignal.AppointmentContext);
  }
  if (conditions.businessHoursOnly === true) {
    required.add(LeadFlowAutomationContextSignal.InsideBusinessHours);
  }
  if (conditions.stopIfReplied === true) {
    required.add(LeadFlowAutomationContextSignal.LeadReplied);
  }
  if (conditions.stopIfHandoff === true) {
    required.add(LeadFlowAutomationContextSignal.HandoffActive);
  }
  if (typeof conditions.minScore === 'number') {
    required.add(LeadFlowAutomationContextSignal.LeadScore);
  }
  if (nonEmptyList(conditions.keywords)) {
    required.add(LeadFlowAutomationContextSignal.MatchedKeywords);
  }
  if (nonEmptyList(conditions.intents)) {
    required.add(LeadFlowAutomationContextSignal.MatchedIntents);
  }
  if (nonEmptyList(conditions.requiredFields)) {
    required.add(LeadFlowAutomationContextSignal.PresentFields);
  }
  if (typeof actions.maxAttempts === 'number') {
    required.add(LeadFlowAutomationContextSignal.AttemptsSoFar);
  }
  if (
    typeof schedule.cooldownHours === 'number' &&
    schedule.cooldownHours > 0
  ) {
    required.add(LeadFlowAutomationContextSignal.HoursSinceLastRun);
  }

  // Stable order so a persisted snapshot is comparable across runs.
  return Object.values(LeadFlowAutomationContextSignal).filter((signal) =>
    required.has(signal),
  );
}

/** Subjects that must be identified before the required signals can be read. */
export function requiredContextSubjects(
  signals: readonly LeadFlowAutomationContextSignal[],
): LeadFlowAutomationContextSubject[] {
  return [
    ...new Set(
      signals.map(
        (signal) => LEADFLOW_AUTOMATION_CONTEXT_SIGNAL_SPECS[signal].subject,
      ),
    ),
  ];
}

function nonEmptyList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((item) => typeof item === 'string' && item.trim() !== '')
  );
}
