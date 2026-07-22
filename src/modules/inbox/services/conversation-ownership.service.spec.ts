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
