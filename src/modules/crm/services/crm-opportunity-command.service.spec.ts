import { ConflictException } from '@nestjs/common';
import { CrmOpportunityEventEntity } from '../entities/crm-opportunity-event.entity';
import { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';
import { CrmPipelineEntity } from '../entities/crm-pipeline.entity';
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

function pipeline(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000021',
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    businessMode: 'general',
    status: 'active',
    deletedAt: null,
    metadata: {},
    ...overrides,
  } as CrmPipelineEntity;
}

function harness(
  options: {
    failOutbox?: boolean;
    initial?: CrmOpportunityEntity[];
    stages?: CrmStageEntity[];
    pipelines?: CrmPipelineEntity[];
  } = {},
) {
  const committed = {
    opportunities: [...(options.initial ?? [])],
    stages: [...(options.stages ?? [stage()])],
    pipelines: [...(options.pipelines ?? [])],
    events: [] as CrmOpportunityEventEntity[],
    outbox: [] as InboxDomainOutboxEntity[],
  };

  const dataSource = {
    transaction: jest.fn(
      async (callback: (manager: unknown) => Promise<unknown>) => {
        const draft = {
          opportunities: committed.opportunities.map((item) => ({ ...item })),
          stages: committed.stages.map((item) => ({ ...item })),
          pipelines: committed.pipelines.map((item) => ({ ...item })),
          events: committed.events.map((item) => ({ ...item })),
          outbox: committed.outbox.map((item) => ({ ...item })),
        };
        const repository = (entity: unknown) => {
          if (entity === CrmOpportunityEntity) {
            return {
              findOne: jest.fn(({ where }: { where: { id?: string } }) =>
                Promise.resolve(
                  where.id
                    ? (draft.opportunities.find(
                        (item) => item.id === where.id,
                      ) ?? null)
                    : (draft.opportunities[0] ?? null),
                ),
              ),
              save: jest.fn((value: CrmOpportunityEntity) => {
                const index = draft.opportunities.findIndex(
                  (item) => item.id === value.id,
                );
                const saved = { ...value } as CrmOpportunityEntity;
                if (index >= 0) draft.opportunities[index] = saved;
                else draft.opportunities.push(saved);
                return Promise.resolve(saved);
              }),
            };
          }
          if (entity === CrmStageEntity) {
            return {
              findOne: jest.fn(({ where }: { where: { id?: string } }) =>
                Promise.resolve(
                  draft.stages.find((item) => item.id === where.id) ?? null,
                ),
              ),
              find: jest.fn(() => Promise.resolve(draft.stages)),
            };
          }
          if (entity === CrmPipelineEntity) {
            return {
              findOne: jest.fn(({ where }: { where: { id?: string } }) =>
                Promise.resolve(
                  draft.pipelines.find((item) => item.id === where.id) ?? null,
                ),
              ),
            };
          }
          if (entity === CrmOpportunityEventEntity) {
            return {
              create: (value: CrmOpportunityEventEntity) => value,
              findOne: jest.fn(
                ({ where }: { where: { idempotencyKey?: string } }) =>
                  Promise.resolve(
                    draft.events.find(
                      (item) => item.idempotencyKey === where.idempotencyKey,
                    ) ?? null,
                  ),
              ),
              save: jest.fn((value: CrmOpportunityEventEntity) => {
                const saved = {
                  ...value,
                  id: `00000000-0000-4000-8000-${String(draft.events.length + 100).padStart(12, '0')}`,
                  createdAt: new Date(),
                } as CrmOpportunityEventEntity;
                draft.events.push(saved);
                return Promise.resolve(saved);
              }),
            };
          }
          return {
            create: (value: InboxDomainOutboxEntity) => value,
            save: jest.fn((value: InboxDomainOutboxEntity) => {
              if (options.failOutbox)
                return Promise.reject(new Error('outbox unavailable'));
              draft.outbox.push(value);
              return Promise.resolve(value);
            }),
          };
        };
        const query = jest.fn(
          (_sql: string, parameters: Array<string | number | null>) => {
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
            return Promise.resolve([]);
          },
        );
        const result = await callback({ getRepository: repository, query });
        committed.opportunities = draft.opportunities;
        committed.stages = draft.stages;
        committed.pipelines = draft.pipelines;
        committed.events = draft.events;
        committed.outbox = draft.outbox;
        return result;
      },
    ),
  };

  return {
    service: new CrmOpportunityCommandService(
      dataSource as never,
      {
        assertTransitionAllowedWithinTransaction: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000090',
          version: 1,
        }),
      } as never,
    ),
    committed,
  };
}

describe('CrmOpportunityCommandService', () => {
  it('moves stage, synchronizes status and appends history/outbox atomically', async () => {
    const initial = opportunity({ valueAmount: '250.00', currency: 'BRL' });
    const { service, committed } = harness({ initial: [initial] });

    const result = await service.moveStage(ctx, initial.id, stage().id, {
      expectedVersion: 3,
      sortOrder: 40,
      idempotencyKey: 'move-1',
      reason: 'manual_stage_move',
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
    expect(committed.events[0]).toMatchObject({
      reason: 'manual_stage_move',
      policyVersion: '00000000-0000-4000-8000-000000000090:v1',
      metadata: {
        transitionPolicyId: '00000000-0000-4000-8000-000000000090',
        transitionPolicyVersion: 1,
      },
    });
    expect(committed.events[1].afterData).toMatchObject({
      status: 'won',
      pipelineId: initial.pipelineId,
      stageId: stage().id,
      valueAmount: '250.00',
      currency: 'BRL',
    });
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

  it('rejects a stale pinned transition policy before persisting', async () => {
    const initial = opportunity();
    const { service, committed } = harness({ initial: [initial] });

    await expect(
      service.moveStage(ctx, initial.id, stage().id, {
        expectedVersion: 3,
        expectedTransitionPolicyId: '00000000-0000-4000-8000-000000000099',
        expectedTransitionPolicyVersion: 2,
        reason: 'manual_stage_move',
      }),
    ).rejects.toMatchObject({
      response: { reasonCode: 'transition_policy_stale' },
    });
    expect(committed.opportunities[0]).toMatchObject({
      stageId: initial.stageId,
      rowVersion: 3,
    });
    expect(committed.events).toHaveLength(0);
    expect(committed.outbox).toHaveLength(0);
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

  it('transfers the same opportunity atomically and records commercial entry/exit facts', async () => {
    const initial = opportunity({
      contactId: '00000000-0000-4000-8000-000000000040',
      inboxConversationId: '00000000-0000-4000-8000-000000000050',
      businessMode: 'general',
    });
    const targetPipeline = pipeline();
    const targetStage = stage({
      id: '00000000-0000-4000-8000-000000000032',
      pipelineId: targetPipeline.id,
      type: 'open',
      isWonStage: false,
      operationMode: 'human_managed',
    });
    const { service, committed } = harness({
      initial: [initial],
      pipelines: [targetPipeline],
      stages: [targetStage],
    });

    const result = await service.transferPipeline(
      ctx,
      initial.id,
      targetPipeline.id,
      targetStage.id,
      {
        actor: { type: 'user', userId: ctx.userId },
        expectedVersion: 3,
        idempotencyKey: 'transfer-1',
        reason: 'manual_pipeline_transfer',
        transferMode: 'manual',
      },
    );

    expect(result.opportunity).toMatchObject({
      id: initial.id,
      contactId: initial.contactId,
      inboxConversationId: initial.inboxConversationId,
      pipelineId: targetPipeline.id,
      stageId: targetStage.id,
      status: 'open',
      rowVersion: 4,
    });
    expect(committed.events.map((event) => event.eventType)).toEqual([
      'pipeline_exited',
      'stage_exited',
      'pipeline_transferred',
      'pipeline_entered',
      'stage_entered',
    ]);
    expect(committed.events[2]).toMatchObject({
      reason: 'manual_pipeline_transfer',
      policyVersion: 'crm-pipeline-transfer-policy-v1',
    });
    expect(committed.outbox).toHaveLength(5);
  });

  it('rolls back a pipeline transfer when canonical event persistence fails', async () => {
    const initial = opportunity({ businessMode: 'general' });
    const targetPipeline = pipeline();
    const targetStage = stage({
      id: '00000000-0000-4000-8000-000000000032',
      pipelineId: targetPipeline.id,
      type: 'open',
      isWonStage: false,
    });
    const { service, committed } = harness({
      failOutbox: true,
      initial: [initial],
      pipelines: [targetPipeline],
      stages: [targetStage],
    });

    await expect(
      service.transferPipeline(
        ctx,
        initial.id,
        targetPipeline.id,
        targetStage.id,
        {
          expectedVersion: 3,
          idempotencyKey: 'transfer-rollback',
          reason: 'manual_pipeline_transfer',
          transferMode: 'manual',
        },
      ),
    ).rejects.toThrow('outbox unavailable');
    expect(committed.opportunities[0]).toMatchObject({
      pipelineId: initial.pipelineId,
      stageId: initial.stageId,
      rowVersion: 3,
    });
    expect(committed.events).toHaveLength(0);
  });

  it('replays a pipeline transfer without duplicating history or changing identity', async () => {
    const initial = opportunity({ businessMode: 'general' });
    const targetPipeline = pipeline();
    const targetStage = stage({
      id: '00000000-0000-4000-8000-000000000032',
      pipelineId: targetPipeline.id,
      type: 'open',
      isWonStage: false,
    });
    const { service, committed } = harness({
      initial: [initial],
      pipelines: [targetPipeline],
      stages: [targetStage],
    });
    const options = {
      expectedVersion: 3,
      idempotencyKey: 'transfer-retry',
      reason: 'manual_pipeline_transfer',
      transferMode: 'manual' as const,
    };

    const first = await service.transferPipeline(
      ctx,
      initial.id,
      targetPipeline.id,
      targetStage.id,
      options,
    );
    const retry = await service.transferPipeline(
      ctx,
      initial.id,
      targetPipeline.id,
      targetStage.id,
      options,
    );

    expect(retry.opportunity.id).toBe(first.opportunity.id);
    expect(retry.opportunity.rowVersion).toBe(4);
    expect(committed.events).toHaveLength(5);
    expect(committed.outbox).toHaveLength(5);
  });

  it('rejects a handoff transfer into an AI-only stage', async () => {
    const initial = opportunity({ businessMode: 'general' });
    const targetPipeline = pipeline();
    const targetStage = stage({
      id: '00000000-0000-4000-8000-000000000032',
      pipelineId: targetPipeline.id,
      type: 'open',
      isWonStage: false,
      operationMode: 'ai_managed',
    });
    const { service, committed } = harness({
      initial: [initial],
      pipelines: [targetPipeline],
      stages: [targetStage],
    });

    await expect(
      service.transferPipeline(
        ctx,
        initial.id,
        targetPipeline.id,
        targetStage.id,
        {
          expectedVersion: 3,
          reason: 'handoff_pipeline_transfer',
          transferMode: 'handoff',
        },
      ),
    ).rejects.toMatchObject({
      response: { reasonCode: 'handoff_target_not_human' },
    });
    expect(committed.opportunities[0]).toMatchObject({
      pipelineId: initial.pipelineId,
      stageId: initial.stageId,
    });
    expect(committed.events).toHaveLength(0);
  });

  it('rejects a stale transfer without mutating the opportunity', async () => {
    const initial = opportunity({ businessMode: 'general', rowVersion: 8 });
    const targetPipeline = pipeline();
    const targetStage = stage({
      id: '00000000-0000-4000-8000-000000000032',
      pipelineId: targetPipeline.id,
      type: 'open',
      isWonStage: false,
    });
    const { service, committed } = harness({
      initial: [initial],
      pipelines: [targetPipeline],
      stages: [targetStage],
    });

    await expect(
      service.transferPipeline(
        ctx,
        initial.id,
        targetPipeline.id,
        targetStage.id,
        {
          expectedVersion: 7,
          reason: 'manual_pipeline_transfer',
          transferMode: 'manual',
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'CRM_OPPORTUNITY_VERSION_CONFLICT' },
    });
    expect(committed.opportunities[0]).toMatchObject({
      pipelineId: initial.pipelineId,
      stageId: initial.stageId,
      rowVersion: 8,
    });
    expect(committed.events).toHaveLength(0);
  });

  it('rejects a stage that does not belong to the target pipeline', async () => {
    const initial = opportunity({ businessMode: 'general' });
    const targetPipeline = pipeline();
    const foreignStage = stage({
      id: '00000000-0000-4000-8000-000000000032',
      pipelineId: '00000000-0000-4000-8000-000000000099',
      type: 'open',
      isWonStage: false,
    });
    const { service, committed } = harness({
      initial: [initial],
      pipelines: [targetPipeline],
      stages: [foreignStage],
    });

    await expect(
      service.transferPipeline(
        ctx,
        initial.id,
        targetPipeline.id,
        foreignStage.id,
        {
          expectedVersion: 3,
          reason: 'manual_pipeline_transfer',
          transferMode: 'manual',
        },
      ),
    ).rejects.toMatchObject({
      response: { reasonCode: 'target_stage_pipeline_mismatch' },
    });
    expect(committed.opportunities[0]).toMatchObject({
      pipelineId: initial.pipelineId,
      stageId: initial.stageId,
    });
    expect(committed.events).toHaveLength(0);
  });
});
