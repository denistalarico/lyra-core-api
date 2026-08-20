import {
  governedBusinessContextWriteAllowed,
  InboxGovernedActionWorker,
} from './inbox-governed-action.worker';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmStageTransitionPolicyEntity } from '../../crm/entities/crm-stage-transition-policy.entity';
import { InboxAgentDecisionEntity } from '../entities/inbox-agent-decision.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities/leadflow-agent.entity';

describe('InboxGovernedActionWorker kill switches', () => {
  it('blocks a claimed action when the effect switch is disabled before execution', async () => {
    const action = {
      id: 'action',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      conversationId: 'conversation',
      decisionId: 'decision',
      ownershipVersion: 1,
      policyVersion: 'inbox-autonomy-policy-v1',
      actionType: 'reply',
      actionKey: 'reply',
      policyOutcome: 'allowed',
      status: 'planned',
      applicationResult: {},
      appliedAt: null,
      failedAt: null,
      errorCode: null,
    };
    const save = jest.fn((value: unknown) => Promise.resolve(value));
    const update = jest.fn();
    const repository = {
      findOneBy: jest.fn().mockResolvedValue(action),
      save,
      update,
    };
    const manager = {
      query: jest.fn().mockResolvedValue([{ id: action.id }]),
      getRepository: jest.fn().mockReturnValue(repository),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
      getRepository: jest.fn().mockReturnValue(repository),
      query: jest
        .fn()
        .mockResolvedValue([{ open_count: 0, exception_count: 1 }]),
    };
    const outbound = { sendAgentText: jest.fn() };
    const worker = new InboxGovernedActionWorker(
      dataSource as never,
      {
        autoReplyEnabled: false,
        autoCrmEnabled: false,
        autoHandoffEnabled: false,
      } as never,
      outbound as never,
      { sendAgentText: jest.fn() } as never,
      { sendAgentText: jest.fn() } as never,
      { transition: jest.fn() } as never,
    );

    await worker.processOnce('test-worker');

    expect(outbound.sendAgentText).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'blocked',
        errorCode: 'effect_kill_switch',
      }),
    );
  });

  it('claims reply and CRM effects before the ownership-changing handoff', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const worker = new InboxGovernedActionWorker(
      {
        transaction: (
          callback: (manager: { query: typeof query }) => unknown,
        ) => Promise.resolve(callback({ query })),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(worker.processOnce('worker-test')).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /WHEN 'ensure_contact' THEN 0[\s\S]*WHEN 'ensure_opportunity' THEN 1[\s\S]*WHEN 'reply' THEN 2[\s\S]*WHEN 'set_stage' THEN 3[\s\S]*WHEN 'handoff' THEN 5[\s\S]*ELSE 4/,
      ),
    );
  });

  it('revalidates and applies a pinned AI stage proposal through CRM command authority', async () => {
    const action = {
      id: 'action-stage',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      conversationId: 'conversation',
      decisionId: 'decision',
      ownershipVersion: 4,
      policyVersion: 'inbox-autonomy-policy-v1',
      actionType: 'set_stage',
      actionKey: 'stage',
      auditRef: 'audit',
    };
    const conversation = {
      id: 'conversation',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      opportunityId: 'opportunity',
      ownershipVersion: 4,
      ownershipState: 'ai_active',
      source: 'whatsapp',
    };
    const opportunity = {
      id: 'opportunity',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      pipelineId: 'pipeline',
      stageId: 'stage-current',
      rowVersion: 7,
      inboxConversationId: 'conversation',
      metadata: {},
      businessContext: {},
    };
    const decision = {
      id: 'decision',
      agentId: 'agent',
      contextSnapshot: {
        latestInboundId: 'message-1',
        allowedEvidenceRefs: ['message:message-1'],
      },
      actionPlan: [
        {
          key: 'stage',
          type: 'set_stage',
          allowed: true,
          opportunityId: 'opportunity',
          fromStageId: 'stage-current',
          stageId: 'stage-qualified',
          transitionPolicyId: 'policy',
          transitionPolicyVersion: 3,
          reasonCode: 'ai_qualified',
          opportunityRowVersion: 7,
          evidenceRefs: ['message:message-1'],
          confidence: 0.91,
        },
      ],
    };
    const save = jest.fn((value: unknown) => Promise.resolve(value));
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === InboxConversationEntity)
          return { findOne: jest.fn().mockResolvedValue(conversation) };
        if (entity === InboxMessageEntity)
          return { findOne: jest.fn().mockResolvedValue({ id: 'message-1' }) };
        if (entity === CrmOpportunityEntity)
          return { findOne: jest.fn().mockResolvedValue(opportunity) };
        if (entity === CrmStageTransitionPolicyEntity)
          return {
            findOne: jest.fn().mockResolvedValue({
              id: 'policy',
              allowedActors: ['ai'],
              version: 3,
            }),
          };
        if (
          entity === InboxConversationEventEntity ||
          entity === InboxDomainOutboxEntity
        )
          return { save };
        throw new Error('Unexpected repository');
      }),
    };
    const moveStageWithinTransaction = jest.fn().mockResolvedValue({
      opportunity: {
        ...opportunity,
        stageId: 'stage-qualified',
        rowVersion: 8,
      },
    });
    const worker = new InboxGovernedActionWorker(
      {
        transaction: (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { moveStageWithinTransaction } as never,
    );
    // This focused test intentionally reaches the private transaction boundary.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const applyCrm = (
      worker as unknown as {
        applyCrm: (
          actionValue: typeof action,
          decisionValue: InboxAgentDecisionEntity,
          conversationValue: InboxConversationEntity,
        ) => Promise<Record<string, unknown>>;
      }
    ).applyCrm.bind(worker);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      applyCrm(
        action,
        decision as unknown as InboxAgentDecisionEntity,
        conversation as unknown as InboxConversationEntity,
      ),
    ).resolves.toEqual({ opportunityId: 'opportunity' });
    expect(moveStageWithinTransaction).toHaveBeenCalledWith(
      manager,
      { tenantId: 'tenant', workspaceId: 'workspace' },
      'opportunity',
      'stage-qualified',
      expect.objectContaining({
        actor: { type: 'ai', agentId: 'agent' },
        expectedVersion: 7,
        expectedTransitionPolicyId: 'policy',
        expectedTransitionPolicyVersion: 3,
        reason: 'ai_qualified',
        idempotencyKey: 'governed:action-stage:stage',
      }),
    );
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('preserves human CRM values while allowing idempotent or governed enrichment', () => {
    expect(
      governedBusinessContextWriteAllowed(
        { niche: 'human value' },
        'niche',
        'agent value',
      ),
    ).toBe(false);
    expect(
      governedBusinessContextWriteAllowed(
        { niche: 'human value' },
        'niche',
        'human value',
      ),
    ).toBe(true);
    expect(
      governedBusinessContextWriteAllowed(
        {
          niche: 'old agent value',
          fieldProvenance: { niche: { source: 'governed_agent' } },
        },
        'niche',
        'new agent value',
      ),
    ).toBe(true);
  });

  it('resolves an optional published human CRM target for handoff coordination', async () => {
    const agentRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'agent',
        publishedVersionId: 'version',
        handoffPolicy: {
          transferOpportunityOnHandoff: true,
          targetPipelineId: 'pipeline-human',
          targetStageId: 'stage-human',
        },
      }),
    };
    const worker = new InboxGovernedActionWorker(
      {
        getRepository: jest.fn((entity) => {
          expect(entity).toBe(LeadFlowAgentEntity);
          return agentRepository;
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    // This focused test intentionally reaches the private policy resolver.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const resolveTransfer = (
      worker as unknown as {
        resolveHandoffTransfer: (
          action: { id: string; tenantId: string; workspaceId: string },
          decision: { agentId: string | null },
        ) => Promise<unknown>;
      }
    ).resolveHandoffTransfer.bind(worker);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      resolveTransfer(
        { id: 'action', tenantId: 'tenant', workspaceId: 'workspace' },
        { agentId: 'agent' },
      ),
    ).resolves.toEqual({
      pipelineId: 'pipeline-human',
      stageId: 'stage-human',
      idempotencyKey: 'handoff:action:pipeline-transfer',
      agentId: 'agent',
    });
  });
});
