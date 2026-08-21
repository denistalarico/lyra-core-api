import { ContactEntity } from '../../../contacts/entities/contact.entity';
import { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../../entities/inbox-domain-outbox.entity';
import { InboxMediaAssetEntity } from '../../entities/inbox-media-asset.entity';
import { InboxMessageEntity } from '../../entities/inbox-message.entity';
import { InboxProcessingBatchEntity } from '../../entities/inbox-processing-batch.entity';
import { InboxSettingsEntity } from '../../entities/inbox-settings.entity';
import { InboundMessageIngestionService } from './inbound-message-ingestion.service';
import type { NormalizedInboundMessage } from '../types/normalized-inbound-message';

function createHarness(internalContact = false) {
  const state: {
    conversation: Record<string, any> | null;
    messages: Array<Record<string, any>>;
    batches: Array<Record<string, any>>;
  } = { conversation: null, messages: [], batches: [] };
  let ids = 0;
  const baseRepository = {
    create: (value: Record<string, unknown>) => value,
    save: async (value: Record<string, any>) => {
      value.id ??= `id-${++ids}`;
      return value;
    },
  };
  const messageRepository = {
    ...baseRepository,
    findOne: jest.fn(
      async ({ where }) =>
        state.messages.find(
          (item) => item.externalMessageId === where.externalMessageId,
        ) ?? null,
    ),
    save: jest.fn(async (value) => {
      await baseRepository.save(value);
      if (!state.messages.includes(value)) state.messages.push(value);
      return value;
    }),
  };
  const conversationRepository = {
    ...baseRepository,
    findOne: jest.fn(async () => state.conversation),
    findOneByOrFail: jest.fn(async () => state.conversation),
    save: jest.fn(async (value) => {
      await baseRepository.save(value);
      state.conversation = value;
      return value;
    }),
  };
  const batchRepository = {
    ...baseRepository,
    findOne: jest.fn(async ({ where }) => {
      if (where.status)
        return (
          state.batches.find((item) => item.status === where.status) ?? null
        );
      return state.batches.at(-1) ?? null;
    }),
    save: jest.fn(async (value) => {
      await baseRepository.save(value);
      if (!state.batches.includes(value)) state.batches.push(value);
      return value;
    }),
  };
  const chain = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    getOne: jest.fn(async () =>
      internalContact ? { id: 'internal-contact' } : null,
    ),
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.andWhere.mockReturnValue(chain);
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn((entity) => {
      if (entity === InboxMessageEntity) return messageRepository;
      if (entity === InboxConversationEntity) return conversationRepository;
      if (entity === InboxProcessingBatchEntity) return batchRepository;
      if (entity === InboxChannelEntity)
        return {
          findOneByOrFail: jest.fn().mockResolvedValue({
            id: 'channel',
            aiEnabled: true,
            defaultAgentId: 'agent',
            settings: {},
          }),
        };
      if (entity === InboxSettingsEntity)
        return { findOne: jest.fn().mockResolvedValue(null) };
      if (entity === ContactEntity) return { createQueryBuilder: () => chain };
      if (entity === InboxMediaAssetEntity) return baseRepository;
      if (
        entity === InboxConversationEventEntity ||
        entity === InboxDomainOutboxEntity
      )
        return baseRepository;
      throw new Error(`Unexpected repository ${entity?.name}`);
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (callback) => callback(manager)),
  };
  const notification = {
    publishInboundMessage: jest.fn().mockResolvedValue(undefined),
  };
  return {
    state,
    service: new InboundMessageIngestionService(
      dataSource as never,
      notification as never,
    ),
    notification,
  };
}

function message(externalMessageId: string): NormalizedInboundMessage {
  return {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    channelId: 'channel',
    channelType: 'whatsapp',
    provider: 'meta',
    externalThreadId: '5511999999999',
    externalMessageId,
    sender: { externalId: '5511999999999', phone: null },
    messageType: 'text',
    content: `message ${externalMessageId}`,
    occurredAt: new Date(),
  };
}

describe('InboundMessageIngestionService durable invariants', () => {
  it('deduplicates provider retries before creating message, batch, or notification', async () => {
    const harness = createHarness();
    await harness.service.ingest(message('wamid.same'));
    const retry = await harness.service.ingest(message('wamid.same'));
    expect(retry.deduplicated).toBe(true);
    expect(harness.state.messages).toHaveLength(1);
    expect(harness.state.batches).toHaveLength(1);
    expect(harness.notification.publishInboundMessage).toHaveBeenCalledTimes(1);
  });

  it('extends one durable 20-second batch for three messages in the silence window', async () => {
    const harness = createHarness();
    await harness.service.ingest(message('wamid.1'));
    const firstDueAt = harness.state.batches[0].dueAt as Date;
    await harness.service.ingest(message('wamid.2'));
    await harness.service.ingest(message('wamid.3'));
    expect(harness.state.batches).toHaveLength(1);
    expect(harness.state.batches[0].messageCount).toBe(3);
    expect(
      (harness.state.batches[0].dueAt as Date).getTime(),
    ).toBeGreaterThanOrEqual(firstDueAt.getTime());
    expect(
      (harness.state.batches[0].dueAt as Date).getTime() - Date.now(),
    ).toBeGreaterThan(19_000);
  });

  it('does not activate AI or create a batch for an internal WhatsApp contact', async () => {
    const harness = createHarness(true);
    const input = message('wamid.internal');
    input.sender.phone = '5511999999999';
    const result = await harness.service.ingest(input);
    expect(result.conversation).toMatchObject({
      qualificationStatus: 'internal',
      ownershipState: 'paused',
      aiEnabled: false,
      contactId: 'internal-contact',
    });
    expect(harness.state.batches).toHaveLength(0);
  });

  it('creates a new generation after the prior silence batch has completed', async () => {
    const harness = createHarness();
    await harness.service.ingest(message('wamid.window-1'));
    harness.state.batches[0].status = 'completed';
    await harness.service.ingest(message('wamid.window-2'));
    expect(harness.state.batches).toHaveLength(2);
    expect(harness.state.batches[1].generation).toBe(2);
  });
});

describe('InboundMessageIngestionService.ingestEcho', () => {
  it('records an echo as outbound/external instead of routing it through ingest()', async () => {
    const harness = createHarness();
    harness.state.conversation = {
      id: 'conversation-1',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      contactId: 'contact-1',
      lastMessagePreview: '',
      lastMessageAt: null,
    };

    const result = await harness.service.ingestEcho(message('mid-echo-1'));

    expect(result?.deduplicated).toBe(false);
    expect(result?.message).toMatchObject({
      direction: 'outbound',
      senderType: 'external',
      externalMessageId: 'mid-echo-1',
      status: 'sent',
    });
    expect(harness.state.conversation.lastMessagePreview).toBe(
      'message mid-echo-1',
    );
    expect(harness.notification.publishInboundMessage).not.toHaveBeenCalled();
  });

  it('deduplicates against a message that already carries the same externalMessageId', async () => {
    const harness = createHarness();
    harness.state.conversation = {
      id: 'conversation-1',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      contactId: 'contact-1',
    };
    harness.state.messages.push({
      id: 'existing-message',
      conversationId: 'conversation-1',
      externalMessageId: 'mid-echo-2',
      direction: 'outbound',
    });

    const result = await harness.service.ingestEcho(message('mid-echo-2'));

    expect(result?.deduplicated).toBe(true);
    expect(result?.message.id).toBe('existing-message');
  });

  it('does not fabricate a conversation when none exists for the thread', async () => {
    const harness = createHarness();
    harness.state.conversation = null;

    const result = await harness.service.ingestEcho(message('mid-echo-3'));

    expect(result).toBeNull();
    expect(harness.state.messages).toHaveLength(0);
  });
});
