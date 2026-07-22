import { ConflictException } from '@nestjs/common';
import { CrmOpportunityEventEntity } from '../entities/crm-opportunity-event.entity';
import { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';
import { CrmStageEntity } from '../entities/crm-stage.entity';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { CrmOpportunityCommandService } from './crm-opportunity-command.service';

const ctx = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003',
};

function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    pipelineId: '00000000-0000-4000-8000-000000000020',
    stageId: '00000000-0000-4000-8000-000000000030',
    status: 'open',
    sortOrder: 0,
    rowVersion: 3,
    wonAt: null,
    lostAt: null,
    lostReason: null,
    assignedUserId: null,
    deletedAt: null,
    metadata: {},
    ...overrides,
  } as CrmOpportunityEntity;
}

function stage(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000031',
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    pipelineId: '00000000-0000-4000-8000-000000000020',
    type: 'won',
    isWonStage: true,
    isLostStage: false,
    sortOrder: 10,
    deletedAt: null,
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  } as CrmStageEntity;
}

function harness(
  options: { failOutbox?: boolean; initial?: CrmOpportunityEntity[] } = {},
) {
  const committed = {
    opportunities: [...(options.initial ?? [])],
    stages: [stage()],
    events: [] as CrmOpportunityEventEntity[],
    outbox: [] as InboxDomainOutboxEntity[],
  };

  const dataSource = {
    transaction: jest.fn(
      async (callback: (manager: unknown) => Promise<unknown>) => {
        const draft = {
          opportunities: committed.opportunities.map((item) => ({ ...item })),
          stages: committed.stages.map((item) => ({ ...item })),
          events: committed.events.map((item) => ({ ...item })),
          outbox: committed.outbox.map((item) => ({ ...item })),
        };
        const repository = (entity: unknown) => {
          if (entity === CrmOpportunityEntity) {
            return {
              findOne: jest.fn(async ({ where }: { where: { id?: string } }) =>
                where.id
                  ? (draft.opportunities.find((item) => item.id === where.id) ??
                    null)
                  : (draft.opportunities[0] ?? null),
              ),
              save: jest.fn(async (value: CrmOpportunityEntity) => {
                const index = draft.opportunities.findIndex(
                  (item) => item.id === value.id,
                );
                const saved = { ...value } as CrmOpportunityEntity;
                if (index >= 0) draft.opportunities[index] = saved;
                else draft.opportunities.push(saved);
                return saved;
              }),
            };
          }
          if (entity === CrmStageEntity) {
            return {
              findOne: jest.fn(
                async ({ where }: { where: { id?: string } }) =>
                  draft.stages.find((item) => item.id === where.id) ?? null,
              ),
              find: jest.fn(async () => draft.stages),
            };
          }
          if (entity === CrmOpportunityEventEntity) {
            return {
              create: (value: CrmOpportunityEventEntity) => value,
              findOne: jest.fn(
                async ({ where }: { where: { idempotencyKey?: string } }) =>
                  draft.events.find(
                    (item) => item.idempotencyKey === where.idempotencyKey,
                  ) ?? null,
              ),
              save: jest.fn(async (value: CrmOpportunityEventEntity) => {
                const saved = {
                  id: `00000000-0000-4000-8000-${String(draft.events.length + 100).padStart(12, '0')}`,
                  createdAt: new Date(),
                  ...value,
                } as CrmOpportunityEventEntity;
                draft.events.push(saved);
                return saved;
              }),
            };
          }
          return {
            create: (value: InboxDomainOutboxEntity) => value,
            save: jest.fn(async (value: InboxDomainOutboxEntity) => {
              if (options.failOutbox) throw new Error('outbox unavailable');
              draft.outbox.push(value);
              return value;
            }),
          };
        };
        const query = jest.fn(
          async (_sql: string, parameters: Array<string | number | null>) => {
            const [, , pipelineId, stageId, movingId, minimumSortOrder] =
              parameters;
            for (const item of draft.opportunities) {
              if (
                item.pipelineId === pipelineId &&
                item.stageId === stageId &&
                item.id !== movingId &&
                item.sortOrder >= Number(minimumSortOrder)
              ) {
                item.sortOrder += 1;
                item.rowVersion += 1;
              }
            }
            return [];
          },
        );
        const result = await callback({ getRepository: repository, query });
        committed.opportunities = draft.opportunities;
        committed.stages = draft.stages;
        committed.events = draft.events;
        committed.outbox = draft.outbox;
        return result;
      },
    ),
  };

  return {
    service: new CrmOpportunityCommandService(dataSource as never),
    committed,
  };
}

describe('CrmOpportunityCommandService', () => {
  it('moves stage, synchronizes status and appends history/outbox atomically', async () => {
    const initial = opportunity();
    const { service, committed } = harness({ initial: [initial] });

    const result = await service.moveStage(ctx, initial.id, stage().id, {
      expectedVersion: 3,
      sortOrder: 40,
      idempotencyKey: 'move-1',
    });

    expect(result.opportunity).toMatchObject({
      stageId: stage().id,
      status: 'won',
      sortOrder: 40,
      rowVersion: 4,
    });
    expect(committed.events.map((event) => event.eventType)).toEqual([
      'stage_changed',
      'status_changed',
      'opportunity_won',
    ]);
    expect(committed.outbox).toHaveLength(3);
  });

  it('rejects stale versions before persisting any mutation', async () => {
    const initial = opportunity();
    const { service, committed } = harness({ initial: [initial] });

    await expect(
      service.moveStage(ctx, initial.id, stage().id, { expectedVersion: 2 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(committed.opportunities[0]).toMatchObject({
      stageId: initial.stageId,
      rowVersion: 3,
    });
    expect(committed.events).toHaveLength(0);
  });

  it('persists a single-card reorder without sort collisions', async () => {
    const moving = opportunity();
    const reference = opportunity({
      id: '00000000-0000-4000-8000-000000000011',
      stageId: stage().id,
      status: 'won',
      sortOrder: 10,
      rowVersion: 7,
    });
    const { service, committed } = harness({ initial: [moving, reference] });

    await service.moveStage(ctx, moving.id, stage().id, {
      expectedVersion: moving.rowVersion,
      beforeOpportunityId: reference.id,
      idempotencyKey: 'move-before-1',
    });

    expect(
      committed.opportunities.find((item) => item.id === moving.id),
    ).toMatchObject({ sortOrder: 10, rowVersion: 4 });
    expect(
      committed.opportunities.find((item) => item.id === reference.id),
    ).toMatchObject({ sortOrder: 11, rowVersion: 8 });
  });

  it('rolls back the opportunity and history when outbox persistence fails', async () => {
    const { service, committed } = harness({ failOutbox: true });

    await expect(
      service.createOpportunity(ctx, opportunity({ rowVersion: 1 }), {
        idempotencyKey: 'create-1',
      }),
    ).rejects.toThrow('outbox unavailable');
    expect(committed.opportunities).toHaveLength(0);
    expect(committed.events).toHaveLength(0);
  });

  it('returns the original aggregate on an idempotent retry', async () => {
    const initial = opportunity();
    const { service, committed } = harness({ initial: [initial] });
    committed.events.push({
      id: '00000000-0000-4000-8000-000000000090',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      opportunityId: initial.id,
      idempotencyKey: 'move-retry',
      createdAt: new Date(),
    } as CrmOpportunityEventEntity);

    const result = await service.moveStage(ctx, initial.id, stage().id, {
      idempotencyKey: 'move-retry',
    });

    expect(result.opportunity).toMatchObject({
      stageId: initial.stageId,
      rowVersion: initial.rowVersion,
    });
    expect(committed.events).toHaveLength(1);
    expect(committed.outbox).toHaveLength(0);
  });
});
