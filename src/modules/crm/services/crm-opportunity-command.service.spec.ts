import { ConflictException } from '@nestjs/common';
import { CrmOpportunityEventEntity } from '../entities/crm-opportunity-event.entity';
import { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';
import { CrmPipelineEntity } from '../entities/crm-pipeline.entity';
import { CrmStageEntity } from '../entities/crm-stage.entity';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
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
    conversations?: InboxConversationEntity[];
  } = {},
) {
  const committed = {
    opportunities: [...(options.initial ?? [])],
    stages: [...(options.stages ?? [stage()])],
    pipelines: [...(options.pipelines ?? [])],
    conversations: [...(options.conversations ?? [])],
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
          conversations: committed.conversations.map((item) => ({ ...item })),
          events: committed.events.map((item) => ({ ...item })),
          outbox: committed.outbox.map((item) => ({ ...item })),
        };
        const repository = (entity: unknown) => {
          if (entity === CrmOpportunityEntity) {
            return {
              create: (value: CrmOpportunityEntity) => value,
              findOne: jest.fn(
                ({ where }: { where: Record<string, unknown> }) =>
                  Promise.resolve(
                    draft.opportunities.find(
                      (item) =>
                        (!where.id || item.id === where.id) &&
                        (!where.pipelineId ||
                          item.pipelineId === where.pipelineId) &&
                        (!where.stageId || item.stageId === where.stageId) &&
                        (!where.inboxConversationId ||
                          item.inboxConversationId ===
                            where.inboxConversationId) &&
                        (!where.status || item.status === where.status),
                    ) ?? null,
                  ),
              ),
              save: jest.fn((value: CrmOpportunityEntity) => {
                const index = draft.opportunities.findIndex(
                  (item) => item.id === value.id,
                );
                const saved = {
                  ...value,
                  id:
                    value.id ??
                    `00000000-0000-4000-8000-${String(draft.opportunities.length + 200).padStart(12, '0')}`,
                } as CrmOpportunityEntity;
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
          if (entity === InboxConversationEntity) {
            return {
              findOne: jest.fn(({ where }: { where: { id?: string } }) =>
                Promise.resolve(
                  draft.conversations.find((item) => item.id === where.id) ??
                    null,
                ),
              ),
              update: jest.fn(
                (
                  where: { id: string },
                  value: Partial<InboxConversationEntity>,
                ) => {
                  const current = draft.conversations.find(
                    (item) => item.id === where.id,
                  );
                  if (current) Object.assign(current, value);
                  return Promise.resolve({ affected: current ? 1 : 0 });
                },
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
        committed.conversations = draft.conversations;
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
      // Scoring runs after the command commits and must never be able to fail
      // the command; these tests assert the command, not the score.
      { recalculateQuietly: jest.fn().mockResolvedValue(undefined) } as never,
    ),
    committed,
  };
}

describe('CrmOpportunityCommandService', () => {
  describe('distributeOpportunityOwner (Fase 4)', () => {
    const pipelineId = opportunity().pipelineId;

    it('assigns an unclaimed lead by channel and emits owner_assigned', async () => {
      const lead = opportunity({ source: 'whatsapp' });
      const { service, committed } = harness({
        initial: [lead],
        pipelines: [
          pipeline({ id: pipelineId, allowedUserIds: ['user-a', 'user-b'] }),
        ],
      });

      const result = await service.distributeOpportunityOwner(
        ctx,
        lead.id,
        { strategy: 'by_channel', channelMap: { whatsapp: 'user-b' } },
        { actor: { type: 'automation' }, expectedVersion: 3, idempotencyKey: 'dist-1' },
      );

      expect(result).toMatchObject({
        assignedUserId: 'user-b',
        reasonCode: 'by_channel',
      });
      expect(result.opportunity).toMatchObject({
        assignedUserId: 'user-b',
        rowVersion: 4,
      });
      expect(committed.events.map((event) => event.eventType)).toEqual([
        'owner_assigned',
      ]);
      expect(committed.events[0]).toMatchObject({
        actorType: 'automation',
        afterData: { assignedUserId: 'user-b', strategy: 'by_channel' },
      });
      expect(committed.outbox).toHaveLength(1);
      expect(committed.outbox[0].eventName).toBe(
        'leadflow.crm.opportunity.owner_assigned',
      );
    });

    it('refuses when the lead already has an owner', async () => {
      const lead = opportunity({ assignedUserId: 'human-1' });
      const { service, committed } = harness({
        initial: [lead],
        pipelines: [pipeline({ id: pipelineId, allowedUserIds: ['user-a'] })],
      });

      await expect(
        service.distributeOpportunityOwner(
          ctx,
          lead.id,
          { strategy: 'by_channel' },
          { expectedVersion: 3 },
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'CRM_LEAD_DISTRIBUTION_BLOCKED',
          reasonCode: 'already_assigned',
        },
      });
      expect(committed.events).toHaveLength(0);
    });

    it('refuses when the pipeline has no eligible assignee', async () => {
      const lead = opportunity();
      const { service } = harness({
        initial: [lead],
        pipelines: [
          pipeline({ id: pipelineId, allowedUserIds: [], ownerUserId: null }),
        ],
      });

      await expect(
        service.distributeOpportunityOwner(
          ctx,
          lead.id,
          { strategy: 'by_channel' },
          { expectedVersion: 3 },
        ),
      ).rejects.toMatchObject({
        response: { reasonCode: 'no_eligible_assignee' },
      });
    });

    it('refuses to distribute a closed opportunity', async () => {
      const lead = opportunity({ status: 'won' });
      const { service } = harness({
        initial: [lead],
        pipelines: [pipeline({ id: pipelineId, allowedUserIds: ['user-a'] })],
      });

      await expect(
        service.distributeOpportunityOwner(
          ctx,
          lead.id,
          { strategy: 'by_channel' },
          { expectedVersion: 3 },
        ),
      ).rejects.toMatchObject({
        response: { reasonCode: 'opportunity_not_open' },
      });
    });
  });

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

  it('creates and points the first conversation opportunity atomically', async () => {
    const conversationId = '00000000-0000-4000-8000-000000000050';
    const contactId = '00000000-0000-4000-8000-000000000040';
    const conversation = {
      id: conversationId,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      contactId,
      opportunityId: null,
    } as InboxConversationEntity;
    const candidate = opportunity({
      id: '00000000-0000-4000-8000-000000000012',
      contactId,
      inboxConversationId: conversationId,
      sourceOpportunityId: null,
      rowVersion: 1,
    });
    const { service, committed } = harness({ conversations: [conversation] });

    const created = await service.createOpportunity(ctx, candidate, {
      idempotencyKey: 'manual-conversation-create-1',
    });

    expect(committed.conversations[0].opportunityId).toBe(created.id);
    expect(committed.events.map((event) => event.eventType)).toEqual([
      'opportunity_created',
    ]);
    await expect(
      service.createOpportunity(
        ctx,
        opportunity({
          id: '00000000-0000-4000-8000-000000000013',
          contactId,
          inboxConversationId: conversationId,
          sourceOpportunityId: null,
          rowVersion: 1,
        }),
        { idempotencyKey: 'manual-conversation-create-2' },
      ),
    ).rejects.toMatchObject({
      response: { reasonCode: 'active_opportunity_exists' },
    });
    expect(committed.opportunities).toHaveLength(1);
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

  it('copies only the governed commercial snapshot into an independent related negotiation', async () => {
    const source = opportunity({
      contactId: '00000000-0000-4000-8000-000000000040',
      contactName: 'Contato canônico',
      contactEmail: 'contato@example.com',
      contactPhone: '+5511999999999',
      inboxConversationId: '00000000-0000-4000-8000-000000000050',
      sourceOpportunityId: null,
      title: 'Negociação original',
      description: 'Escopo comercial permitido',
      valueAmount: '1500.00',
      currency: 'BRL',
      priority: 'high',
      source: 'whatsapp',
      businessMode: 'general',
      operationalStatus: 'human_active',
      businessContext: { agentSummary: 'não copiar' },
      assignedUserId: ctx.userId,
      expectedCloseDate: '2026-08-01',
      nextFollowUpAt: new Date(),
      lastActivityAt: new Date(),
      followMode: 'automatic',
      followMessage: 'não copiar',
      followSendAutomatically: true,
      visibility: 'workspace',
      metadata: { clientId: 'client-1', operatingMode: 'client' },
    });
    const targetPipeline = pipeline();
    const targetStage = stage({
      id: '00000000-0000-4000-8000-000000000032',
      pipelineId: targetPipeline.id,
      type: 'open',
      isWonStage: false,
      isInitialStage: true,
    });
    const { service, committed } = harness({
      initial: [source],
      pipelines: [targetPipeline],
      stages: [targetStage],
    });
    const options = {
      expectedVersion: source.rowVersion,
      idempotencyKey: 'copy-related-1',
      reason: 'distinct_negotiation',
    };

    const copied = await service.copyOpportunity(
      ctx,
      source.id,
      {
        pipelineId: targetPipeline.id,
        stageId: targetStage.id,
        title: 'Nova negociação',
      },
      options,
    );
    const replay = await service.copyOpportunity(
      ctx,
      source.id,
      {
        pipelineId: targetPipeline.id,
        stageId: targetStage.id,
        title: 'Nova negociação',
      },
      options,
    );

    expect(copied).toMatchObject({
      contactId: source.contactId,
      sourceOpportunityId: source.id,
      inboxConversationId: null,
      assignedUserId: null,
      operationalStatus: null,
      expectedCloseDate: null,
      nextFollowUpAt: null,
      lastActivityAt: null,
      followMode: 'manual',
      followMessage: null,
      followSendAutomatically: false,
      status: 'open',
      title: 'Nova negociação',
      metadata: {
        creationKind: 'copy',
        clientId: 'client-1',
      },
    });
    expect(copied.id).not.toBe(source.id);
    expect(copied.businessContext).not.toHaveProperty('agentSummary');
    expect(replay.id).toBe(copied.id);
    expect(committed.opportunities).toHaveLength(2);
    expect(committed.opportunities[0]).toMatchObject({
      id: source.id,
      inboxConversationId: source.inboxConversationId,
      rowVersion: source.rowVersion,
    });
    expect(committed.events.map((event) => event.eventType)).toEqual([
      'opportunity_created',
      'opportunity_copied',
    ]);
    expect(committed.events[1]).toMatchObject({
      reason: 'distinct_negotiation',
      policyVersion: 'crm-opportunity-copy-policy-v1',
    });
  });

  it('reconverts a terminal primary opportunity without reopening it and replays safely', async () => {
    const conversationId = '00000000-0000-4000-8000-000000000050';
    const contactId = '00000000-0000-4000-8000-000000000040';
    const source = opportunity({
      contactId,
      contactName: 'Contato canônico',
      inboxConversationId: conversationId,
      sourceOpportunityId: null,
      title: 'Ciclo encerrado',
      status: 'lost',
      lostAt: new Date('2026-07-01T00:00:00.000Z'),
      businessMode: 'general',
      currency: 'BRL',
      priority: 'normal',
      source: 'whatsapp',
      metadata: { operatingMode: 'agency' },
    });
    const targetPipeline = pipeline();
    const initialStage = stage({
      id: '00000000-0000-4000-8000-000000000032',
      pipelineId: targetPipeline.id,
      type: 'open',
      isWonStage: false,
      isLostStage: false,
      isInitialStage: true,
    });
    const conversation = {
      id: conversationId,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      contactId,
      opportunityId: source.id,
    } as InboxConversationEntity;
    const { service, committed } = harness({
      initial: [source],
      pipelines: [targetPipeline],
      stages: [initialStage],
      conversations: [conversation],
    });
    const options = {
      expectedVersion: source.rowVersion,
      idempotencyKey: 'reconversion-1',
      reason: 'renewed_interest',
    };

    const reconverted = await service.reconvertOpportunity(
      ctx,
      source.id,
      { pipelineId: targetPipeline.id, title: 'Novo ciclo' },
      options,
    );
    const replay = await service.reconvertOpportunity(
      ctx,
      source.id,
      { pipelineId: targetPipeline.id, title: 'Novo ciclo' },
      options,
    );

    expect(reconverted).toMatchObject({
      contactId,
      inboxConversationId: conversationId,
      sourceOpportunityId: source.id,
      pipelineId: targetPipeline.id,
      stageId: initialStage.id,
      status: 'open',
      title: 'Novo ciclo',
    });
    expect(reconverted.id).not.toBe(source.id);
    expect(replay.id).toBe(reconverted.id);
    expect(committed.opportunities).toHaveLength(2);
    expect(committed.opportunities[0]).toMatchObject({
      id: source.id,
      status: 'lost',
      lostAt: source.lostAt,
      rowVersion: source.rowVersion,
    });
    expect(committed.conversations[0].opportunityId).toBe(reconverted.id);
    expect(committed.events.map((event) => event.eventType)).toEqual([
      'opportunity_created',
      'opportunity_reconverted',
    ]);
    expect(committed.events[1]).toMatchObject({
      reason: 'renewed_interest',
      policyVersion: 'crm-opportunity-reconversion-policy-v1',
    });
  });

  it('rejects reconversion while the source opportunity is still open', async () => {
    const source = opportunity({
      contactId: '00000000-0000-4000-8000-000000000040',
      inboxConversationId: null,
      businessMode: 'general',
      currency: 'BRL',
      priority: 'normal',
      source: 'manual',
      title: 'Ciclo ativo',
      metadata: {},
    });
    const targetPipeline = pipeline();
    const initialStage = stage({
      id: '00000000-0000-4000-8000-000000000032',
      pipelineId: targetPipeline.id,
      type: 'open',
      isWonStage: false,
      isInitialStage: true,
    });
    const { service, committed } = harness({
      initial: [source],
      pipelines: [targetPipeline],
      stages: [initialStage],
    });

    await expect(
      service.reconvertOpportunity(
        ctx,
        source.id,
        { pipelineId: targetPipeline.id },
        { reason: 'new_conversion' },
      ),
    ).rejects.toMatchObject({
      response: { reasonCode: 'source_not_terminal' },
    });
    expect(committed.opportunities).toHaveLength(1);
    expect(committed.events).toHaveLength(0);
  });
});

describe('CrmOpportunityCommandService — autonomy mode (D3)', () => {
  // A non-terminal destination so a stage move produces no status events —
  // isolating the autonomy behaviour from won/lost side effects.
  const openStage = () =>
    stage({
      id: '00000000-0000-4000-8000-000000000032',
      type: 'open',
      isWonStage: false,
      isLostStage: false,
    });

  it('refuses an automation stage move on a manual card', async () => {
    const initial = opportunity({
      autonomyMode: 'manual',
      inboxConversationId: '00000000-0000-4000-8000-0000000000c0',
    });
    const { service, committed } = harness({
      initial: [initial],
      stages: [openStage()],
    });

    await expect(
      service.moveStage(ctx, initial.id, openStage().id, {
        actor: { type: 'automation' },
        expectedVersion: 3,
        reason: 'governed_stage_advance',
      }),
    ).rejects.toMatchObject({ response: { reasonCode: 'opportunity_is_manual' } });

    expect(committed.opportunities[0]).toMatchObject({
      stageId: initial.stageId,
      autonomyMode: 'manual',
      rowVersion: 3,
    });
    expect(committed.events).toHaveLength(0);
  });

  it('flips a LeadFlow card to manual on a human move and records the event', async () => {
    const initial = opportunity({
      autonomyMode: 'automatic',
      inboxConversationId: '00000000-0000-4000-8000-0000000000c1',
    });
    const { service, committed } = harness({
      initial: [initial],
      stages: [openStage()],
    });

    const result = await service.moveStage(ctx, initial.id, openStage().id, {
      expectedVersion: 3,
      reason: 'manual_stage_move',
    });

    expect(result.opportunity.autonomyMode).toBe('manual');
    expect(committed.events.map((event) => event.eventType)).toEqual([
      'stage_changed',
      'autonomy_mode_changed',
    ]);
    const autonomyEvent = committed.events.find(
      (event) => event.eventType === 'autonomy_mode_changed',
    );
    expect(autonomyEvent?.afterData).toMatchObject({ autonomyMode: 'manual' });
  });

  it('does not flip or emit for a non-LeadFlow (Agency Sales) human move', async () => {
    const initial = opportunity({ autonomyMode: 'automatic' }); // no LeadFlow signals
    const { service, committed } = harness({
      initial: [initial],
      stages: [openStage()],
    });

    const result = await service.moveStage(ctx, initial.id, openStage().id, {
      expectedVersion: 3,
      reason: 'manual_stage_move',
    });

    expect(result.opportunity.autonomyMode).toBe('automatic');
    expect(committed.events.map((event) => event.eventType)).toEqual([
      'stage_changed',
    ]);
  });

  it('setAutonomyMode changes the mode, emits once, and is idempotent', async () => {
    const initial = opportunity({ autonomyMode: 'automatic' });
    const { service, committed } = harness({ initial: [initial] });

    const first = await service.setAutonomyMode(ctx, initial.id, 'manual');
    expect(first.autonomyMode).toBe('manual');
    expect(committed.events.map((event) => event.eventType)).toEqual([
      'autonomy_mode_changed',
    ]);

    const second = await service.setAutonomyMode(ctx, initial.id, 'manual');
    expect(second.autonomyMode).toBe('manual');
    // No second event: setting the same mode is a no-op.
    expect(committed.events).toHaveLength(1);
  });
});
