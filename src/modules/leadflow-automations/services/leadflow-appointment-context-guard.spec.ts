import { LeadFlowAutomationContextLoaderService } from './leadflow-automation-context-loader.service';
import { LeadFlowAutomationContextService } from './leadflow-automation-context.service';
import { LeadFlowAutomationEvaluationService } from './leadflow-automation-evaluation.service';
import {
  LeadFlowAutomationRunStatus,
  LeadFlowAutomationSkipReason,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationContextSignal } from '../types/leadflow-automation-context.types';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';

const APPOINTMENT = 'a1b2c3d4-0000-4000-8000-000000000001';
const CONVERSATION = 'c1b2c3d4-0000-4000-8000-000000000002';
const OPPORTUNITY = 'd1b2c3d4-0000-4000-8000-000000000003';
const STARTS_AT = new Date('2026-08-01T13:00:00.000Z');

/** A commitment with everything the guard demands. */
function commitment(overrides: Record<string, unknown> = {}) {
  return {
    id: APPOINTMENT,
    type: 'meeting',
    status: 'scheduled',
    startAt: STARTS_AT,
    dueAt: null,
    timezone: 'America/Sao_Paulo',
    contactId: 'contact-1',
    sourceChannel: 'whatsapp',
    sourceConversationId: CONVERSATION,
    sourceOpportunityId: OPPORTUNITY,
    metadata: { appointmentStatus: 'pending' },
    ...overrides,
  };
}

function automation(): LeadFlowAutomationEntity {
  return {
    id: 'automation-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    recipeKey: 'appointment_reminder',
    businessModeKey: 'clinics_esthetics',
    triggerConfig: { type: 'appointment.created' },
    conditionConfig: { businessHoursOnly: false, stopIfReplied: false },
    actionConfig: { primaryAction: 'schedule_appointment_reminder' },
    messageConfig: {},
    crmPolicy: {},
    schedulePolicy: {},
  } as unknown as LeadFlowAutomationEntity;
}

function delivery(): LeadFlowEventDeliveryEntity {
  return {
    id: 'delivery-1',
    sourceEventId: 'event-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    eventName: 'leadflow.calendar.appointment.created',
    aggregateType: 'scheduled_item',
    aggregateId: APPOINTMENT,
    payload: { appointmentId: APPOINTMENT, startsAt: STARTS_AT.toISOString() },
    occurredAt: new Date(),
  } as unknown as LeadFlowEventDeliveryEntity;
}

function build(appointment: Record<string, unknown> | null) {
  const appointments = { findOne: jest.fn().mockResolvedValue(appointment) };
  const loader = new LeadFlowAutomationContextLoaderService(
    { findOne: jest.fn().mockResolvedValue(null), exist: jest.fn() } as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    appointments as never,
    { createQueryBuilder: jest.fn() } as never,
    { getForOpportunity: jest.fn() } as never,
    { listFields: jest.fn() } as never,
  );
  return {
    appointments,
    contextService: new LeadFlowAutomationContextService(loader),
    evaluation: new LeadFlowAutomationEvaluationService(),
  };
}

const recipe = {
  businessModeKeys: 'all' as const,
  primaryAction: 'schedule_appointment_reminder' as const,
};

describe('agenda context guard', () => {
  it('establishes the commitment and follows its links to conversation and opportunity', async () => {
    const { contextService, evaluation } = build(commitment());

    const resolutions = await contextService.resolveForDelivery(
      [automation()],
      delivery(),
    );
    const resolution = resolutions.get('automation-1');

    expect(resolution?.snapshot.subjects).toMatchObject({
      scheduled_item: APPOINTMENT,
      inbox_conversation: CONVERSATION,
      crm_opportunity: OPPORTUNITY,
    });
    expect(resolution?.context.appointmentContext).toMatchObject({
      appointmentId: APPOINTMENT,
      startsAt: STARTS_AT.toISOString(),
      serviceRef: 'meeting',
      channel: 'whatsapp',
      lifecycleStatus: 'pending',
    });

    const verdict = evaluation.evaluate(
      automation(),
      recipe,
      resolution?.context,
      resolution?.gaps,
    );
    expect(verdict.wouldAct).toBe(true);
    expect(verdict.plannedActions).toEqual(['schedule_appointment_reminder']);
  });

  it.each([
    ['sem data e hora', { startAt: null, dueAt: null }, 'data e hora'],
    ['sem tipo utilizável', { type: 'task' }, 'tipo'],
    [
      'sem contato nem conversa',
      { contactId: null, sourceConversationId: null },
      'contato',
    ],
    ['sem canal', { sourceChannel: '   ' }, 'canal'],
  ])(
    'ignora por contexto ausente um compromisso %s',
    async (_label, missing, expected) => {
      const { contextService, evaluation } = build(commitment(missing));

      const resolutions = await contextService.resolveForDelivery(
        [automation()],
        delivery(),
      );
      const resolution = resolutions.get('automation-1');
      const gap =
        resolution?.gaps[LeadFlowAutomationContextSignal.AppointmentContext];

      expect(gap?.gap).toBe('missing_context');
      expect(gap?.detail).toContain(expected);

      const verdict = evaluation.evaluate(
        automation(),
        recipe,
        resolution?.context,
        resolution?.gaps,
      );
      expect(verdict.wouldAct).toBe(false);
      expect(verdict.status).toBe(LeadFlowAutomationRunStatus.Skipped);
      expect(verdict.skipReason).toBe(
        LeadFlowAutomationSkipReason.MissingContext,
      );
      expect(verdict.plannedActions).toEqual([]);
    },
  );

  it('ignora por contexto ausente quando o compromisso não existe no workspace', async () => {
    const { contextService, evaluation } = build(null);

    const resolutions = await contextService.resolveForDelivery(
      [automation()],
      delivery(),
    );
    const resolution = resolutions.get('automation-1');
    const verdict = evaluation.evaluate(
      automation(),
      recipe,
      resolution?.context,
      resolution?.gaps,
    );

    expect(verdict.skipReason).toBe(
      LeadFlowAutomationSkipReason.MissingContext,
    );
    expect(
      resolution?.gaps[LeadFlowAutomationContextSignal.AppointmentContext]
        ?.detail,
    ).toContain('não foi encontrado');
  });

  it('não lê a Agenda quando o gatilho da automação não é de agenda', async () => {
    const { appointments, contextService } = build(commitment());
    const nonAgenda = {
      ...automation(),
      triggerConfig: { type: 'opportunity.created' },
    } as LeadFlowAutomationEntity;

    await contextService.resolveForDelivery([nonAgenda], delivery());

    expect(appointments.findOne).not.toHaveBeenCalled();
  });
});
