import { BadRequestException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowOperationsActionEntity } from '../entities';
import { LeadFlowOperationsActionEventEntity } from '../entities/leadflow-operations-action-event.entity';
import { LeadFlowOperationsActionService } from './leadflow-operations-action.service';

function createHarness() {
  const actions: LeadFlowOperationsActionEntity[] = [];
  const events: LeadFlowOperationsActionEventEntity[] = [];
  const settings = {
    id: '00000000-0000-4000-8000-000000000010',
    tenantId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    contextType: LeadFlowSettingsContextType.Agency,
    agencyClientId: null,
    businessModeKey: 'restaurants_food',
  };
  const actionRepository = {
    create: (value: Partial<LeadFlowOperationsActionEntity>) =>
      value as LeadFlowOperationsActionEntity,
    save: async (value: LeadFlowOperationsActionEntity) => {
      const existing = actions.findIndex((item) => item.id === value.id);
      const saved = {
        ...value,
        id:
          value.id ??
          `00000000-0000-4000-8000-${String(actions.length + 20).padStart(12, '0')}`,
        createdAt: value.createdAt ?? new Date('2026-08-09T15:00:00.000Z'),
        updatedAt: new Date('2026-08-09T15:00:00.000Z'),
      } as LeadFlowOperationsActionEntity;
      if (existing >= 0) actions[existing] = saved;
      else actions.push(saved);
      return saved;
    },
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      actions.find(
        (item) =>
          (!where.id || item.id === where.id) &&
          (!where.idempotencyKey ||
            item.idempotencyKey === where.idempotencyKey),
      ) ?? null,
    find: async () => [...actions],
  };
  const eventRepository = {
    create: (value: Partial<LeadFlowOperationsActionEventEntity>) =>
      value as LeadFlowOperationsActionEventEntity,
    save: async (value: LeadFlowOperationsActionEventEntity) => {
      const saved = {
        ...value,
        id: `00000000-0000-4000-8000-${String(events.length + 50).padStart(12, '0')}`,
        createdAt: new Date('2026-08-09T15:00:00.000Z'),
      } as LeadFlowOperationsActionEventEntity;
      events.push(saved);
      return saved;
    },
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === LeadFlowOperationsActionEntity
        ? actionRepository
        : eventRepository,
  };
  const dataSource = {
    transaction: <T>(run: (value: typeof manager) => Promise<T>) =>
      run(manager),
  };
  const settingsRepository = {
    findOne: jest.fn().mockResolvedValue(settings),
  };
  const service = new LeadFlowOperationsActionService(
    dataSource as unknown as DataSource,
    settingsRepository as unknown as Repository<LeadFlowClientSettingsEntity>,
    actionRepository as unknown as Repository<LeadFlowOperationsActionEntity>,
  );
  const ctx = {
    tenantId: settings.tenantId,
    workspaceId: settings.workspaceId,
    userId: '00000000-0000-4000-8000-000000000003',
  };
  return { service, ctx, actions, events };
}

describe('LeadFlowOperationsActionService', () => {
  it('proposes and explicitly confirms a canonical availability operation', async () => {
    const harness = createHarness();
    const proposed = await harness.service.propose(harness.ctx, {
      intent: 'capacity_released',
      requestText: 'Liberou uma mesa sexta às 15h',
      idempotencyKey: 'message-1',
      payload: {
        timezone: 'America/Sao_Paulo',
        resourceRef: 'table_slot',
        resourceLabel: 'Mesa liberada',
        effectivePeriod: {
          startsAt: '2026-08-14T18:00:00.000Z',
          endsAt: '2026-08-14T19:00:00.000Z',
        },
      },
    });

    expect(proposed.status).toBe('pending_confirmation');
    expect(proposed.canConfirm).toBe(true);
    expect(harness.events.map((event) => event.eventType)).toEqual([
      'proposed',
    ]);

    const confirmed = await harness.service.confirm(harness.ctx, proposed.id, {
      expectedRevision: proposed.revision,
    });

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.revision).toBe(2);
    expect(confirmed.canConfirm).toBe(false);
    expect(harness.events.map((event) => event.eventType)).toEqual([
      'proposed',
      'confirmed',
    ]);
  });

  it('keeps an incomplete closure blocked from confirmation', async () => {
    const harness = createHarness();
    const proposed = await harness.service.propose(harness.ctx, {
      intent: 'add_closure',
      requestText: 'No próximo feriado não vamos abrir',
      idempotencyKey: 'message-2',
      payload: { timezone: 'America/Sao_Paulo' },
    });

    expect(proposed.canConfirm).toBe(false);
    expect(proposed.validationIssues).toContain(
      'Informe quando a alteração começa.',
    );
    await expect(
      harness.service.confirm(harness.ctx, proposed.id, {
        expectedRevision: proposed.revision,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
