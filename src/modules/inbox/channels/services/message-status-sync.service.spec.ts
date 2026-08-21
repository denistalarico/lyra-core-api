/* eslint-disable @typescript-eslint/no-unsafe-assignment -- focused repository/service doubles */
import { NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import { InboxConversationEventEntity } from '../../entities/inbox-conversation-event.entity';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import { InboxDomainOutboxEntity } from '../../entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../../entities/inbox-message.entity';
import type { NormalizedMessageReactionUpdate } from '../types/normalized-message-reaction-update';
import type {
  NormalizedMessageStatusUpdate,
  NormalizedMessageStatusWatermarkUpdate,
} from '../types/normalized-message-status-update';
import type { InboxMetaOperationLedgerService } from '../whatsapp/services/inbox-meta-operation-ledger.service';
import { MessageStatusSyncService } from './message-status-sync.service';

describe('MessageStatusSyncService', () => {
  it('applies a sent -> delivered -> read progression in order', async () => {
    const harness = createHarness({ status: 'sent' });

    await harness.service.applyStatusUpdate(buildInput({ status: 'delivered' }));
    expect(harness.message?.status).toBe('delivered');
    expect(harness.message?.deliveredAt).not.toBeNull();

    await harness.service.applyStatusUpdate(buildInput({ status: 'read' }));
    expect(harness.message?.status).toBe('read');
    expect(harness.message?.readAt).not.toBeNull();

    expect(harness.repository.save).toHaveBeenCalledTimes(2);
  });

  it('does not downgrade a read message when a stale delivered event arrives late', async () => {
    const harness = createHarness({ status: 'read' });

    await harness.service.applyStatusUpdate(buildInput({ status: 'delivered' }));

    expect(harness.message?.status).toBe('read');
    expect(harness.repository.save).not.toHaveBeenCalled();
    expect(harness.metaLedger.reconcileDelivery).not.toHaveBeenCalled();
  });

  it('does not downgrade a read message when a stale failed event arrives late', async () => {
    const harness = createHarness({ status: 'read' });

    await harness.service.applyStatusUpdate(buildInput({ status: 'failed' }));

    expect(harness.message?.status).toBe('read');
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('applies failed when the message has not progressed past sent', async () => {
    const harness = createHarness({ status: 'sent' });

    await harness.service.applyStatusUpdate(buildInput({ status: 'failed' }));

    expect(harness.message?.status).toBe('failed');
    expect(harness.repository.save).toHaveBeenCalledTimes(1);
  });

  it('recovers from failed when a later delivered event arrives', async () => {
    const harness = createHarness({ status: 'failed' });

    await harness.service.applyStatusUpdate(buildInput({ status: 'delivered' }));

    expect(harness.message?.status).toBe('delivered');
    expect(harness.message?.deliveredAt).not.toBeNull();
  });

  it('always records the conversation event, even when the status update is ignored as a regression', async () => {
    const harness = createHarness({ status: 'read' });

    await harness.service.applyStatusUpdate(buildInput({ status: 'delivered' }));

    expect(harness.eventsRepository.save).toHaveBeenCalledTimes(1);
    expect(harness.eventsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          ignoredAsRegression: true,
          previousStatus: 'read',
          status: 'delivered',
        }),
      }),
    );
  });

  it('backfills deliveredAt when read arrives without a prior delivered event', async () => {
    const harness = createHarness({ status: 'sent' });

    await harness.service.applyStatusUpdate(buildInput({ status: 'read' }));

    expect(harness.message?.deliveredAt).not.toBeNull();
    expect(harness.message?.readAt).not.toBeNull();
  });

  it('throws when the message cannot be found for the provider status update', async () => {
    const harness = createHarness({}, null);

    await expect(
      harness.service.applyStatusUpdate(buildInput({ status: 'delivered' })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('records a realtime outbox event when the status actually changes', async () => {
    const harness = createHarness({ status: 'sent' });

    await harness.service.applyStatusUpdate(buildInput({ status: 'delivered' }));

    expect(harness.outboxRepository.save).toHaveBeenCalledTimes(1);
    expect(harness.outboxRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateType: 'inbox_conversation',
        aggregateId: 'conversation-id',
        eventName: 'leadflow.inbox.conversation.message.status_updated',
        payload: expect.objectContaining({
          conversationId: 'conversation-id',
          messageId: 'message-id',
          status: 'delivered',
        }),
      }),
    );
  });

  it('does not record a realtime outbox event when the update is ignored as a regression', async () => {
    const harness = createHarness({ status: 'read' });

    await harness.service.applyStatusUpdate(buildInput({ status: 'delivered' }));

    expect(harness.outboxRepository.save).not.toHaveBeenCalled();
  });

  it('swallows a duplicate outbox idempotency key instead of failing the webhook', async () => {
    const harness = createHarness({ status: 'sent' });
    harness.outboxRepository.save.mockRejectedValueOnce(
      new QueryFailedError('insert', [], Object.assign(new Error('duplicate'), {
        code: '23505',
      })),
    );

    await expect(
      harness.service.applyStatusUpdate(buildInput({ status: 'delivered' })),
    ).resolves.toMatchObject({ status: 'delivered' });
  });

  it('lets a non-duplicate outbox failure propagate', async () => {
    const harness = createHarness({ status: 'sent' });
    harness.outboxRepository.save.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      harness.service.applyStatusUpdate(buildInput({ status: 'delivered' })),
    ).rejects.toThrow('connection lost');
  });
});

describe('MessageStatusSyncService.applyReaction', () => {
  it('derives actorKey from the channel type instead of a hardcoded provider', async () => {
    const harness = createHarness({ status: 'delivered' });

    await harness.service.applyReaction(
      buildReactionInput({ channelType: 'facebook_messenger', senderId: 'psid-1' }),
    );

    expect(harness.message?.metadata?.reaction).toMatchObject({
      actorKey: 'facebook_messenger:psid-1',
      emoji: '❤',
    });
  });

  it('removes the reaction on unreact', async () => {
    const harness = createHarness({
      status: 'delivered',
      metadata: {
        reactions: [
          { actorKey: 'instagram:ig-user-1', actorType: 'contact', emoji: '❤' },
        ],
      },
    });

    await harness.service.applyReaction(
      buildReactionInput({
        channelType: 'instagram',
        senderId: 'ig-user-1',
        action: 'unreact',
        emoji: null,
      }),
    );

    expect(harness.message?.metadata?.reactions).toEqual([]);
    expect(harness.message?.metadata?.reaction).toBeNull();
  });

  it('records a realtime outbox event for the reaction update', async () => {
    const harness = createHarness({ status: 'delivered' });

    await harness.service.applyReaction(buildReactionInput({}));

    expect(harness.outboxRepository.save).toHaveBeenCalledTimes(1);
    expect(harness.outboxRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'leadflow.inbox.conversation.message.reaction_updated',
        payload: expect.objectContaining({
          conversationId: 'conversation-id',
          messageId: 'message-id',
        }),
      }),
    );
  });

  it('throws when the message cannot be found for the provider reaction update', async () => {
    const harness = createHarness({}, null);

    await expect(
      harness.service.applyReaction(buildReactionInput({})),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MessageStatusSyncService.applyStatusWatermark', () => {
  it('applies the status to every outbound message at or under the watermark', async () => {
    const harness = createHarness({}, undefined, {
      outboundMessages: [{ status: 'sent' }, { status: 'delivered' }],
    });

    await harness.service.applyStatusWatermark(buildWatermarkInput({}));

    expect(harness.repository.save).toHaveBeenCalledTimes(1);
    const saved = harness.repository.save.mock.calls[0][0] as unknown as Array<{
      status: string;
    }>;
    expect(saved).toHaveLength(2);
    expect(saved.every((message) => message.status === 'read')).toBe(true);
    expect(harness.conversationsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          lastReadWatermark: buildWatermarkInput({}).watermark.toISOString(),
        }),
      }),
    );
  });

  it('does not touch messages already at or above the target status', async () => {
    const harness = createHarness({}, undefined, {
      outboundMessages: [{ status: 'read' }],
    });

    const result = await harness.service.applyStatusWatermark(
      buildWatermarkInput({ status: 'delivered' }),
    );

    expect(result.updatedMessageIds).toEqual([]);
    expect(harness.repository.save).not.toHaveBeenCalled();
    expect(harness.outboxRepository.save).not.toHaveBeenCalled();
  });

  it('is a no-op when a stale or duplicate watermark arrives', async () => {
    const harness = createHarness({}, undefined, {
      conversation: {
        metadata: { lastReadWatermark: '2026-01-03T00:00:00.000Z' },
      },
    });

    const result = await harness.service.applyStatusWatermark(
      buildWatermarkInput({ watermark: new Date('2026-01-02T00:00:00Z') }),
    );

    expect(result.updatedMessageIds).toEqual([]);
    expect(harness.repository.find).not.toHaveBeenCalled();
    expect(harness.conversationsRepository.save).not.toHaveBeenCalled();
  });

  it('records a realtime outbox event when messages are updated', async () => {
    const harness = createHarness({}, undefined, {
      outboundMessages: [{ status: 'sent' }],
    });

    await harness.service.applyStatusWatermark(buildWatermarkInput({}));

    expect(harness.outboxRepository.save).toHaveBeenCalledTimes(1);
    expect(harness.outboxRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'leadflow.inbox.conversation.message.status_updated',
        payload: expect.objectContaining({ conversationId: 'conversation-id' }),
      }),
    );
  });

  it('throws when the conversation cannot be found for the watermark update', async () => {
    const harness = createHarness({}, undefined, { conversation: null });

    await expect(
      harness.service.applyStatusWatermark(buildWatermarkInput({})),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

function buildInput(
  overrides: Partial<NormalizedMessageStatusUpdate> = {},
): NormalizedMessageStatusUpdate {
  return {
    tenantId: 'tenant-id',
    workspaceId: 'workspace-id',
    channelId: 'channel-id',
    provider: 'meta',
    channelType: 'whatsapp',
    externalMessageId: 'wamid.external',
    status: 'delivered',
    occurredAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

function buildReactionInput(
  overrides: Partial<NormalizedMessageReactionUpdate>,
): NormalizedMessageReactionUpdate {
  return {
    tenantId: 'tenant-id',
    workspaceId: 'workspace-id',
    channelId: 'channel-id',
    provider: 'meta',
    channelType: 'instagram',
    externalMessageId: 'wamid.external',
    senderId: 'ig-user-1',
    action: 'react',
    emoji: '❤',
    occurredAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

function buildWatermarkInput(
  overrides: Partial<NormalizedMessageStatusWatermarkUpdate>,
): NormalizedMessageStatusWatermarkUpdate {
  return {
    tenantId: 'tenant-id',
    workspaceId: 'workspace-id',
    channelId: 'channel-id',
    provider: 'meta',
    channelType: 'facebook_messenger',
    externalThreadId: 'facebook_messenger:page-1:psid-1',
    status: 'read',
    watermark: new Date('2026-01-02T00:00:00Z'),
    recipientId: 'psid-1',
    ...overrides,
  };
}

function createHarness(
  messageOverrides: Partial<InboxMessageEntity> = {},
  foundMessage?: null,
  extra: {
    conversation?: Partial<InboxConversationEntity> | null;
    outboundMessages?: Partial<InboxMessageEntity>[];
  } = {},
) {
  const message: InboxMessageEntity | null =
    foundMessage === null
      ? null
      : ({
          id: 'message-id',
          tenantId: 'tenant-id',
          workspaceId: 'workspace-id',
          conversationId: 'conversation-id',
          channelId: 'channel-id',
          externalMessageId: 'wamid.external',
          status: 'sent',
          deliveredAt: null,
          readAt: null,
          metadata: {},
          ...messageOverrides,
        } as InboxMessageEntity);

  const conversation: InboxConversationEntity | null =
    extra.conversation === null
      ? null
      : ({
          id: 'conversation-id',
          tenantId: 'tenant-id',
          workspaceId: 'workspace-id',
          channelId: 'channel-id',
          externalThreadId: 'facebook_messenger:page-1:psid-1',
          metadata: {},
          ...extra.conversation,
        } as InboxConversationEntity);

  const outboundMessages = (extra.outboundMessages ?? []).map(
    (overrides, index) =>
      ({
        id: `outbound-message-${index}`,
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
        conversationId: 'conversation-id',
        direction: 'outbound',
        status: 'sent',
        deliveredAt: null,
        readAt: null,
        occurredAt: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
      }) as InboxMessageEntity,
  );

  const repository = {
    findOne: jest.fn(() => Promise.resolve(message)),
    find: jest.fn(() => Promise.resolve(outboundMessages)),
    save: jest.fn((entity: InboxMessageEntity) => Promise.resolve(entity)),
  };
  const conversationsRepository = {
    findOne: jest.fn(() => Promise.resolve(conversation)),
    save: jest.fn((entity: InboxConversationEntity) =>
      Promise.resolve(entity),
    ),
  };
  const eventsRepository = {
    create: jest.fn((payload: unknown) => payload),
    save: jest.fn(() => Promise.resolve(undefined)),
  };
  const outboxRepository = {
    create: jest.fn((payload: unknown) => payload),
    save: jest.fn(() => Promise.resolve(undefined)),
  };
  const metaLedger = {
    reconcileDelivery: jest.fn(() => Promise.resolve(undefined)),
  };

  const service = new MessageStatusSyncService(
    repository as unknown as Repository<InboxMessageEntity>,
    conversationsRepository as unknown as Repository<InboxConversationEntity>,
    eventsRepository as unknown as Repository<InboxConversationEventEntity>,
    outboxRepository as unknown as Repository<InboxDomainOutboxEntity>,
    metaLedger as unknown as InboxMetaOperationLedgerService,
  );

  return {
    service,
    message,
    repository,
    conversation,
    conversationsRepository,
    eventsRepository,
    outboxRepository,
    metaLedger,
  };
}
