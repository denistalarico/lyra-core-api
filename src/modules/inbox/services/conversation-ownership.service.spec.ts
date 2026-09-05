import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { ConversationOwnershipService } from './conversation-ownership.service';

function handoffConversation() {
  return {
    id: 'conversation',
    tenantId: 'tenant',
    workspaceId: 'workspace',
    opportunityId: 'opportunity',
    ownershipState: 'handoff_requested',
    ownershipVersion: 2,
    aiEnabled: false,
    metadata: {},
  } as InboxConversationEntity;
}

function harness(transferResult: Promise<unknown>) {
  const conversation = handoffConversation();
  const saveConversation = jest.fn((value: InboxConversationEntity) =>
    Promise.resolve(value),
  );
  const saveEvent = jest.fn((value: unknown) => Promise.resolve(value));
  const saveOutbox = jest.fn((value: unknown) => Promise.resolve(value));
  const manager = {
    getRepository: jest.fn((entity) => {
      if (entity === InboxConversationEntity)
        return {
          findOne: jest.fn().mockResolvedValue(conversation),
          save: saveConversation,
        };
      if (entity === InboxConversationEventEntity) return { save: saveEvent };
      if (entity === InboxDomainOutboxEntity) return { save: saveOutbox };
      throw new Error('Unexpected repository');
    }),
  };
  const transferPipeline = jest.fn(() => transferResult);
  const dataSource = {
    getRepository: jest.fn((entity) => {
      if (entity === CrmOpportunityEntity)
        return {
          findOneBy: jest.fn().mockResolvedValue({
            id: 'opportunity',
            rowVersion: 5,
          }),
        };
      throw new Error('Unexpected repository');
    }),
    transaction: jest.fn(
      (callback: (value: typeof manager) => Promise<unknown>) =>
        callback(manager),
    ),
  };
  const service = new ConversationOwnershipService(
    dataSource as never,
    undefined,
    { transferPipeline } as never,
  );
  jest.spyOn(service, 'transition').mockResolvedValue(conversation);
  return {
    service,
    transferPipeline,
    saveConversation,
    saveEvent,
    saveOutbox,
  };
}

describe('ConversationOwnershipService coordinated handoff transfer', () => {
  const ctx = { tenantId: 'tenant', workspaceId: 'workspace' };
  const transfer = {
    pipelineId: 'pipeline-human',
    stageId: 'stage-human',
    idempotencyKey: 'handoff:action:transfer',
    agentId: 'agent',
  };

  it('keeps handoff safe and records a failed commercial transfer', async () => {
    const failure = Object.assign(new Error('blocked'), {
      response: { reasonCode: 'handoff_target_not_human' },
    });
    const h = harness(Promise.reject(failure));

    const result = await h.service.requestHandoff(
      ctx,
      'conversation',
      'qualified',
      transfer,
    );

    expect(result).toMatchObject({
      ownershipState: 'handoff_requested',
      aiEnabled: false,
      metadata: {
        handoffTransfer: {
          status: 'failed',
          errorCode: 'handoff_target_not_human',
        },
      },
    });
    expect(h.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'handoff_transfer_failed' }),
    );
    expect(h.saveOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'leadflow.inbox.conversation.handoff.transfer.failed',
      }),
    );
  });

  it('transfers the same opportunity after handoff and records completion', async () => {
    const h = harness(
      Promise.resolve({ opportunity: { id: 'opportunity' }, event: {} }),
    );

    const result = await h.service.requestHandoff(
      ctx,
      'conversation',
      'qualified',
      transfer,
    );

    expect(h.transferPipeline).toHaveBeenCalledWith(
      ctx,
      'opportunity',
      'pipeline-human',
      'stage-human',
      expect.objectContaining({
        expectedVersion: 5,
        reason: 'handoff_pipeline_transfer',
        transferMode: 'handoff',
        actor: { type: 'ai', agentId: 'agent' },
      }),
    );
    expect(result).toMatchObject({
      ownershipState: 'handoff_requested',
      aiEnabled: false,
      metadata: {
        handoffTransfer: { status: 'completed' },
      },
    });
  });
});

describe('ConversationOwnershipService manual AI activation', () => {
  function activationHarness(
    conversationOverrides: Partial<InboxConversationEntity> = {},
  ) {
    const conversation = {
      id: 'conversation-ai',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      channelId: 'instagram-channel',
      opportunityId: null,
      status: 'open',
      ownershipState: 'paused',
      ownershipVersion: 1,
      ownershipReason: null,
      ownershipChangedAt: new Date(),
      assignedUserId: 'user',
      assignedAgentId: null,
      aiEnabled: false,
      qualificationStatus: 'disqualified',
      qualificationReason: 'no_matching_rule',
      metadata: {},
      ...conversationOverrides,
    } as unknown as InboxConversationEntity;
    const repositories = new Map<
      unknown,
      { findOne?: jest.Mock; create?: jest.Mock; save: jest.Mock }
    >([
      [
        InboxConversationEntity,
        {
          findOne: jest.fn().mockResolvedValue(conversation),
          save: jest.fn((value) => Promise.resolve(value)),
        },
      ],
      [
        InboxConversationEventEntity,
        // `create` as well as `save`: the qualification transition recorder
        // builds the entity before saving it, the way the rest of this domain
        // writes conversation events.
        { create: jest.fn((value: unknown) => value), save: jest.fn() },
      ],
      [InboxDomainOutboxEntity, { save: jest.fn() }],
    ]);
    const queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const manager = {
      getRepository: jest.fn((entity) => repositories.get(entity)),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    const dataSource = {
      transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
        callback(manager),
      ),
    };
    const events = repositories.get(InboxConversationEventEntity) as {
      create: jest.Mock;
      save: jest.Mock;
    };
    return {
      conversation,
      events,
      saveConversation: repositories.get(InboxConversationEntity)?.save,
      service: new ConversationOwnershipService(dataSource as never),
    };
  }

  it('does not overwrite a concurrent human takeover with a failure handoff', async () => {
    const harness = activationHarness({
      ownershipState: 'human_active',
      aiEnabled: false,
      assignedUserId: 'human-owner',
    });

    await expect(
      harness.service.requestHandoffIfAiOwner(
        { tenantId: 'tenant', workspaceId: 'workspace' },
        'conversation-ai',
        'agent_decision_failed:decision_evidence_invalid',
      ),
    ).resolves.toMatchObject({
      ownershipState: 'human_active',
      aiEnabled: false,
      assignedUserId: 'human-owner',
    });
    expect(harness.saveConversation).not.toHaveBeenCalled();
    expect(harness.events.save).not.toHaveBeenCalled();
  });

  it('treats an explicit human activation as qualification for a legacy conversation', async () => {
    const harness = activationHarness();

    await expect(
      harness.service.transition(
        { tenantId: 'tenant', workspaceId: 'workspace', userId: 'user' },
        'conversation-ai',
        'return_ai',
      ),
    ).resolves.toMatchObject({
      ownershipState: 'ai_active',
      aiEnabled: true,
      qualificationStatus: 'qualified',
      qualificationReason: 'manual_ai_activation',
    });
  });

  it('records the operator behind a manual activation in the history', async () => {
    const harness = activationHarness();

    await harness.service.transition(
      { tenantId: 'tenant', workspaceId: 'workspace', userId: 'user' },
      'conversation-ai',
      'return_ai',
    );

    // The operator is knowable here, so the history says who it was rather
    // than falling back to `system`.
    const [event] = harness.events.create.mock.calls[0] as [
      {
        eventType: string;
        actorType: string;
        actorUserId: string | null;
        payload: Record<string, unknown>;
      },
    ];
    expect(event).toMatchObject({
      eventType: 'qualification_status_changed',
      actorType: 'user',
      actorUserId: 'user',
    });
    expect(event.payload).toMatchObject({
      previousStatus: 'disqualified',
      newStatus: 'qualified',
      reason: 'manual_ai_activation',
    });
  });

  it('keeps an explicit communication opt-out ineligible for AI', async () => {
    const harness = activationHarness({
      metadata: {
        leadflowOutboundOptOut: {
          status: 'opted_out',
          recordedAt: '2026-08-16T12:00:00.000Z',
          source: 'inbound_keyword',
          sourceMessageId: 'message-opt-out',
        },
      },
    });

    await expect(
      harness.service.transition(
        { tenantId: 'tenant', workspaceId: 'workspace', userId: 'user' },
        'conversation-ai',
        'return_ai',
      ),
    ).rejects.toThrow('not eligible for automatic replies');
  });
});
