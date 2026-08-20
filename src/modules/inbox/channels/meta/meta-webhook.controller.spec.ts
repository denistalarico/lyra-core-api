import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { MetaChannelUnavailableError } from './services/meta-channel-resolver.service';
import { MetaWebhookController } from './meta-webhook.controller';

describe('MetaWebhookController', () => {
  const previousSecret = process.env.META_APP_SECRET;
  const previousInstagramSecret = process.env.META_INSTAGRAM_APP_SECRET;
  const whatsappAdapter = {
    normalize: jest.fn().mockResolvedValue({ messages: [] }),
    normalizeStatuses: jest.fn().mockResolvedValue({ statuses: [] }),
  };
  const instagramAdapter = {
    normalize: jest.fn().mockResolvedValue({ messages: [] }),
    normalizeStatuses: jest.fn().mockResolvedValue({ statuses: [] }),
    normalizeReactions: jest.fn().mockResolvedValue({ reactions: [] }),
  };
  const messengerAdapter = {
    normalize: jest.fn().mockResolvedValue({ messages: [] }),
  };
  const ingestion = { ingest: jest.fn() };
  const webhookLog = { create: jest.fn().mockResolvedValue(undefined) };
  const statusSync = {
    applyStatusUpdate: jest.fn(),
    applyInstagramReaction: jest.fn(),
  };
  const controller = new MetaWebhookController(
    whatsappAdapter as never,
    instagramAdapter as never,
    messengerAdapter as never,
    ingestion as never,
    webhookLog as never,
    statusSync as never,
  );

  beforeEach(() => {
    process.env.META_APP_SECRET = 'whatsapp-secret';
    process.env.META_INSTAGRAM_APP_SECRET = 'instagram-secret';
    jest.clearAllMocks();
    whatsappAdapter.normalize.mockResolvedValue({ messages: [] });
    whatsappAdapter.normalizeStatuses.mockResolvedValue({ statuses: [] });
    instagramAdapter.normalize.mockResolvedValue({ messages: [] });
    instagramAdapter.normalizeStatuses.mockResolvedValue({ statuses: [] });
    instagramAdapter.normalizeReactions.mockResolvedValue({ reactions: [] });
    messengerAdapter.normalize.mockResolvedValue({ messages: [] });
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
    if (previousInstagramSecret === undefined) {
      delete process.env.META_INSTAGRAM_APP_SECRET;
    } else {
      process.env.META_INSTAGRAM_APP_SECRET = previousInstagramSecret;
    }
  });

  function signedRequest(payload: { object?: string }, secret?: string) {
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signingSecret =
      secret ??
      (payload.object === 'instagram' ? 'instagram-secret' : 'whatsapp-secret');
    const signature = `sha256=${createHmac('sha256', signingSecret)
      .update(rawBody)
      .digest('hex')}`;
    return { rawBody, signature };
  }

  it('keeps WhatsApp routed through the existing adapter and status pipeline', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: { metadata: { phone_number_id: 'phone-1' } },
            },
          ],
        },
      ],
    };
    const request = signedRequest(payload);

    await expect(
      controller.receiveWebhook(
        request.signature,
        { rawBody: request.rawBody } as never,
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, signatureReceived: true });

    expect(whatsappAdapter.normalize).toHaveBeenCalledWith(payload);
    expect(whatsappAdapter.normalizeStatuses).toHaveBeenCalledWith(payload);
    expect(instagramAdapter.normalize).not.toHaveBeenCalled();
    expect(messengerAdapter.normalize).not.toHaveBeenCalled();
  });

  it('routes Instagram messages to its adapter and canonical ingestion pipeline', async () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-account-1',
          messaging: [
            {
              sender: { id: 'ig-user-1' },
              recipient: { id: 'ig-account-1' },
              message: { mid: 'ig-mid-1', text: 'Ola' },
            },
          ],
        },
      ],
    };
    const normalizedMessage = {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      channelType: 'instagram' as const,
      provider: 'meta',
      externalThreadId: 'instagram:ig-account-1:ig-user-1',
      externalMessageId: 'ig-mid-1',
      sender: { externalId: 'ig-user-1' },
      messageType: 'text' as const,
      content: 'Ola',
    };
    instagramAdapter.normalize.mockResolvedValue({
      messages: [normalizedMessage],
    });
    ingestion.ingest.mockResolvedValue({
      conversation: { id: 'conversation-1' },
      message: { id: 'message-1' },
    });
    const request = signedRequest(payload);

    await expect(
      controller.receiveWebhook(
        request.signature,
        { rawBody: request.rawBody } as never,
        payload,
      ),
    ).resolves.toMatchObject({
      ok: true,
      provider: 'meta',
      messagesProcessed: 1,
      statusesProcessed: 0,
    });

    expect(instagramAdapter.normalize).toHaveBeenCalledWith(payload);
    expect(ingestion.ingest).toHaveBeenCalledWith(normalizedMessage);
    expect(whatsappAdapter.normalize).not.toHaveBeenCalled();
    expect(whatsappAdapter.normalizeStatuses).not.toHaveBeenCalled();
    expect(messengerAdapter.normalize).not.toHaveBeenCalled();
    expect(statusSync.applyStatusUpdate).not.toHaveBeenCalled();
    expect(webhookLog.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      provider: 'meta',
      eventType: 'message',
      status: 'processed',
      externalAccountId: 'ig-account-1',
      externalPhoneNumberId: null,
      externalMessageId: 'ig-mid-1',
      signatureReceived: true,
      messagesProcessed: 1,
      statusesProcessed: 0,
      payload: {},
      metadata: {
        workload: 'instagram',
        results: [
          {
            conversationId: 'conversation-1',
            messageId: 'message-1',
            externalMessageId: 'ig-mid-1',
          },
        ],
        statusResults: [],
        reactionResults: [],
      },
    });
  });

  it('routes Instagram reaction webhooks to the native reaction sync', async () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-account-1',
          messaging: [
            {
              sender: { id: 'ig-user-1' },
              recipient: { id: 'ig-account-1' },
              reaction: {
                mid: 'ig-mid-1',
                action: 'react',
                emoji: '❤',
              },
            },
          ],
        },
      ],
    };
    const normalizedReaction = {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      externalMessageId: 'ig-mid-1',
      senderId: 'ig-user-1',
      action: 'react' as const,
      emoji: '❤',
      occurredAt: new Date('2026-08-16T12:00:00.000Z'),
    };
    instagramAdapter.normalizeReactions.mockResolvedValue({
      reactions: [normalizedReaction],
    });
    statusSync.applyInstagramReaction.mockResolvedValue({ id: 'message-1' });
    const request = signedRequest(payload);

    await expect(
      controller.receiveWebhook(
        request.signature,
        { rawBody: request.rawBody } as never,
        payload,
      ),
    ).resolves.toMatchObject({
      ok: true,
      messagesProcessed: 0,
      reactionsProcessed: 1,
    });
    expect(statusSync.applyInstagramReaction).toHaveBeenCalledWith(
      normalizedReaction,
    );
    expect(webhookLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        channelId: 'channel-1',
        eventType: 'message_reaction',
      }),
    );
  });

  it.each([undefined, 'sha256=deadbeef'])(
    'rejects an absent or invalid signature',
    async (signature) => {
      const rawBody = Buffer.from('{}');

      await expect(
        controller.receiveWebhook(signature, { rawBody } as never, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(whatsappAdapter.normalize).not.toHaveBeenCalled();
      expect(instagramAdapter.normalize).not.toHaveBeenCalled();
    },
  );

  it('rejects an Instagram webhook signed with the WhatsApp app secret', async () => {
    const payload = { object: 'instagram', entry: [] };
    const request = signedRequest(payload, 'whatsapp-secret');

    await expect(
      controller.receiveWebhook(
        request.signature,
        { rawBody: request.rawBody } as never,
        payload,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(instagramAdapter.normalize).not.toHaveBeenCalled();
  });

  it('falls back to META_APP_SECRET when no Instagram-specific secret exists', async () => {
    delete process.env.META_INSTAGRAM_APP_SECRET;
    const payload = { object: 'instagram', entry: [] };
    const request = signedRequest(payload, 'whatsapp-secret');

    await expect(
      controller.receiveWebhook(
        request.signature,
        { rawBody: request.rawBody } as never,
        payload,
      ),
    ).resolves.toMatchObject({ ok: true, signatureReceived: true });
  });

  it('routes Messenger messages to its adapter and canonical ingestion pipeline', async () => {
    const payload = {
      object: 'page' as const,
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'page-1' },
              message: { mid: 'mid-1', text: 'Olá' },
            },
          ],
        },
      ],
    };
    const normalizedMessage = {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'messenger-channel-1',
      channelType: 'facebook_messenger' as const,
      provider: 'meta',
      externalThreadId: 'facebook_messenger:page-1:psid-1',
      externalMessageId: 'mid-1',
      sender: { externalId: 'psid-1' },
      messageType: 'text' as const,
      content: 'Olá',
    };
    messengerAdapter.normalize.mockResolvedValue({
      messages: [normalizedMessage],
    });
    ingestion.ingest.mockResolvedValue({
      conversation: { id: 'conversation-1' },
      message: { id: 'message-1' },
    });
    const request = signedRequest(payload);

    await expect(
      controller.receiveWebhook(
        request.signature,
        { rawBody: request.rawBody } as never,
        payload,
      ),
    ).resolves.toMatchObject({
      ok: true,
      messagesProcessed: 1,
      statusesProcessed: 0,
      reactionsProcessed: 0,
    });
    expect(messengerAdapter.normalize).toHaveBeenCalledWith(payload);
    expect(ingestion.ingest).toHaveBeenCalledWith(normalizedMessage);
    expect(whatsappAdapter.normalize).not.toHaveBeenCalled();
    expect(whatsappAdapter.normalizeStatuses).not.toHaveBeenCalled();
    expect(instagramAdapter.normalize).not.toHaveBeenCalled();
    expect(instagramAdapter.normalizeStatuses).not.toHaveBeenCalled();
    expect(instagramAdapter.normalizeReactions).not.toHaveBeenCalled();
    expect(statusSync.applyStatusUpdate).not.toHaveBeenCalled();
    expect(statusSync.applyInstagramReaction).not.toHaveBeenCalled();
    expect(webhookLog.create).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'messenger-channel-1',
      provider: 'meta',
      eventType: 'message',
      status: 'processed',
      externalAccountId: 'page-1',
      externalPhoneNumberId: null,
      externalMessageId: 'mid-1',
      signatureReceived: true,
      messagesProcessed: 1,
      statusesProcessed: 0,
      payload: {},
      metadata: {
        workload: 'messenger',
        results: [
          {
            conversationId: 'conversation-1',
            messageId: 'message-1',
            externalMessageId: 'mid-1',
          },
        ],
      },
    });
  });

  it('rejects a Messenger webhook with an invalid signature before dispatch', async () => {
    const payload = { object: 'page' as const, entry: [] };
    const rawBody = Buffer.from(JSON.stringify(payload));

    await expect(
      controller.receiveWebhook(
        'sha256=deadbeef',
        { rawBody } as never,
        payload,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(messengerAdapter.normalize).not.toHaveBeenCalled();
    expect(whatsappAdapter.normalize).not.toHaveBeenCalled();
    expect(instagramAdapter.normalize).not.toHaveBeenCalled();
  });

  it('does not dispatch an unsupported payload to any adapter', async () => {
    const payload = { object: 'unsupported', entry: [] };
    const request = signedRequest(payload);

    await expect(
      controller.receiveWebhook(
        request.signature,
        { rawBody: request.rawBody } as never,
        payload,
      ),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'unsupported_meta_payload',
    });
    expect(whatsappAdapter.normalize).not.toHaveBeenCalled();
    expect(whatsappAdapter.normalizeStatuses).not.toHaveBeenCalled();
    expect(instagramAdapter.normalize).not.toHaveBeenCalled();
    expect(instagramAdapter.normalizeStatuses).not.toHaveBeenCalled();
    expect(instagramAdapter.normalizeReactions).not.toHaveBeenCalled();
    expect(messengerAdapter.normalize).not.toHaveBeenCalled();
  });

  it('accepts and logs an unavailable Instagram channel as ignored', async () => {
    const payload = {
      object: 'instagram',
      entry: [{ id: 'ig-account-1', messaging: [] }],
    };
    const channel = {
      id: 'channel-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      connectionStatus: 'suspended',
    };
    instagramAdapter.normalize.mockRejectedValue(
      new MetaChannelUnavailableError(channel as never),
    );
    const request = signedRequest(payload);

    await expect(
      controller.receiveWebhook(
        request.signature,
        { rawBody: request.rawBody } as never,
        payload,
      ),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'meta_channel_unavailable',
    });
    expect(ingestion.ingest).not.toHaveBeenCalled();
    expect(webhookLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        channelId: 'channel-1',
        provider: 'meta',
        status: 'ignored',
        externalAccountId: 'ig-account-1',
        externalPhoneNumberId: null,
        errorMessage: 'meta_channel_unavailable',
        metadata: {
          workload: 'instagram',
          connectionStatus: 'suspended',
        },
      }),
    );
  });

  it('accepts and logs an unavailable Messenger channel as ignored', async () => {
    const payload = {
      object: 'page' as const,
      entry: [{ id: 'page-1', messaging: [] }],
    };
    const channel = {
      id: 'messenger-channel-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      connectionStatus: 'suspended',
    };
    messengerAdapter.normalize.mockRejectedValue(
      new MetaChannelUnavailableError(channel as never),
    );
    const request = signedRequest(payload);

    await expect(
      controller.receiveWebhook(
        request.signature,
        { rawBody: request.rawBody } as never,
        payload,
      ),
    ).resolves.toEqual({
      ok: true,
      ignored: true,
      reason: 'meta_channel_unavailable',
    });
    expect(ingestion.ingest).not.toHaveBeenCalled();
    expect(webhookLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        channelId: 'messenger-channel-1',
        provider: 'meta',
        status: 'ignored',
        externalAccountId: 'page-1',
        externalPhoneNumberId: null,
        errorMessage: 'meta_channel_unavailable',
        metadata: {
          workload: 'messenger',
          connectionStatus: 'suspended',
        },
      }),
    );
  });
});
