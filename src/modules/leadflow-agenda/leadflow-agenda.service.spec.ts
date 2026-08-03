import { ActivityEntityType, ActivityVisibility } from '../activities/enums';
import { LeadFlowAgendaRolloutService } from './leadflow-agenda-rollout.service';
import { LeadFlowAgendaService } from './leadflow-agenda.service';

const CONTEXT = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
};

const DATE = new Date('2026-08-03T12:00:00.000Z');

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appointment-1',
    type: 'meeting',
    status: 'scheduled',
    title: 'Demonstração',
    description: 'Produto',
    notes: null,
    startAt: DATE,
    endAt: new Date('2026-08-03T13:00:00.000Z'),
    dueAt: null,
    timezone: 'America/Sao_Paulo',
    assignedUserId: 'user-1',
    ownerUserId: 'user-2',
    contactId: 'contact-1',
    sourceLeadId: 'lead-1',
    sourceOpportunityId: 'opportunity-1',
    metadata: { appointmentStatus: 'confirmed' },
    createdAt: DATE,
    updatedAt: DATE,
    ...overrides,
  };
}

function activity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'activity-1',
    sourceModule: 'leadflow',
    visibility: ActivityVisibility.Workspace,
    createdById: 'user-1',
    assignedToId: 'user-1',
    summary: 'Retomar negociação',
    note: 'Enviar proposta',
    startAt: null,
    endAt: null,
    dueAt: DATE,
    status: 'todo',
    createdAt: DATE,
    updatedAt: DATE,
    links: [
      {
        entityType: ActivityEntityType.CrmOpportunity,
        entityId: 'opportunity-1',
      },
    ],
    ...overrides,
  };
}

describe('LeadFlowAgendaService', () => {
  const appointmentsService = {
    listScheduledItems: jest.fn(),
    getScheduledItem: jest.fn(),
    createScheduledItem: jest.fn(),
    patchScheduledItem: jest.fn(),
    patchAppointmentLifecycleStatus: jest.fn(),
    deleteScheduledItem: jest.fn(),
    listParticipants: jest.fn(),
    addParticipant: jest.fn(),
    patchParticipantResponse: jest.fn(),
    listReminders: jest.fn(),
    addReminder: jest.fn(),
    cancelReminder: jest.fn(),
  };
  const activitiesService = {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.LEADFLOW_CANONICAL_AGENDA_ROLLOUT = 'tenant-1:workspace-1';
  });

  afterAll(() => {
    delete process.env.LEADFLOW_CANONICAL_AGENDA_ROLLOUT;
  });

  function service() {
    return new LeadFlowAgendaService(
      appointmentsService as never,
      activitiesService as never,
      new LeadFlowAgendaRolloutService(),
    );
  }

  it('maps appointments and linked LeadFlow activities with stable source IDs', async () => {
    appointmentsService.listScheduledItems.mockResolvedValue([appointment()]);
    activitiesService.list.mockResolvedValue([activity()]);

    const result = await service().listItems(CONTEXT);

    expect(result).toMatchObject({ version: 'v1', mode: 'canonical' });
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agendaItemId: 'scheduled_item:appointment-1',
          source: 'scheduled_item',
          state: 'confirmed',
          opportunityId: 'opportunity-1',
        }),
        expect.objectContaining({
          agendaItemId: 'activity:activity-1',
          source: 'activity',
          state: 'todo',
          opportunityId: 'opportunity-1',
        }),
      ]),
    );
  });

  it('keeps the legacy projection to appointments until the context rollout is enabled', async () => {
    delete process.env.LEADFLOW_CANONICAL_AGENDA_ROLLOUT;
    appointmentsService.listScheduledItems.mockResolvedValue([appointment()]);

    const result = await service().listItems(CONTEXT);

    expect(result).toMatchObject({ mode: 'legacy_appointments' });
    expect(result.items).toHaveLength(1);
    expect(activitiesService.list).not.toHaveBeenCalled();
  });

  it('does not expose a private activity to a different user', async () => {
    appointmentsService.listScheduledItems.mockResolvedValue([appointment()]);
    activitiesService.list.mockResolvedValue([
      activity({ visibility: ActivityVisibility.Private, createdById: 'user-2', assignedToId: 'user-3' }),
    ]);

    const result = await service().listItems(CONTEXT);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].source).toBe('scheduled_item');
  });

  it('forwards appointment writes once to the existing lifecycle owner', async () => {
    const dto = { type: 'meeting', title: 'Reunião' };
    appointmentsService.createScheduledItem.mockResolvedValue(appointment());

    await service().createAppointment(CONTEXT, dto as never);

    expect(appointmentsService.createScheduledItem).toHaveBeenCalledTimes(1);
    expect(appointmentsService.createScheduledItem).toHaveBeenCalledWith(
      CONTEXT,
      dto,
    );
    expect(activitiesService.create).not.toHaveBeenCalled();
  });

  it('marks adapter-created activities as LeadFlow owned without changing the original ID', async () => {
    const dto = { type: 'follow_up', summary: 'Retorno' };
    activitiesService.create.mockResolvedValue(activity());

    await service().createActivity(CONTEXT, dto as never);

    expect(activitiesService.create).toHaveBeenCalledWith(
      CONTEXT,
      expect.objectContaining({ ...dto, sourceModule: 'leadflow' }),
    );
  });
});
