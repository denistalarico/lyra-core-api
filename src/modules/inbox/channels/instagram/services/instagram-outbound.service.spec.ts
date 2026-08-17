import { NotFoundException } from '@nestjs/common';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../../../entities/inbox-message.entity';
import { InstagramOutboundService } from './instagram-outbound.service';

describe('InstagramOutboundService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('delivers text through the Instagram Messages API and persists the Meta id', async () => {
    const harness = createHarness();
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          recipient_id: 'ig-scoped-user',
          message_id: 'ig-message-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    global.fetch = fetchMock;

    const result = await harness.service.sendText({
      ctx: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      to: harness.conversation.externalThreadId!,
      text: 'Olá pelo Instagram',
      idempotencyKey: 'instagram-text-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.instagram.com/v24.0/ig-professional-account/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer decrypted-token',
        }),
        body: JSON.stringify({
          recipient: { id: 'ig-scoped-user' },
          message: { text: 'Olá pelo Instagram' },
        }),
      }),
    );
    expect(result.message).toMatchObject({
      externalMessageId: 'ig-message-1',
      status: 'sent',
      content: 'Olá pelo Instagram',
    });
    expect(harness.conversation).toMatchObject({
      status: 'open',
      lastMessagePreview: 'Olá pelo Instagram',
    });
  });

  it('uses the Meta-documented love reaction payload', async () => {
    const harness = createHarness();
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ recipient_id: 'ig-scoped-user' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;

    await expect(
      harness.service.deliverReaction({
        conversation: harness.conversation,
        message: {
          channelId: 'channel-1',
          externalMessageId: 'ig-message-inbound',
        } as InboxMessageEntity,
        emoji: '❤️',
      }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ig-professional-account/messages'),
      expect.objectContaining({
        body: JSON.stringify({
          recipient: { id: 'ig-scoped-user' },
          sender_action: 'react',
          payload: {
            message_id: 'ig-message-inbound',
            reaction: 'love',
          },
        }),
      }),
    );
  });

  it('does not expose a channel from another managed client context', async () => {
    const harness = createHarness({
      metadata: { operatingMode: 'client', clientId: 'client-a' },
    });

    await expect(
      harness.service.sendText({
        ctx: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          managedContext: {
            productKey: 'leadflow',
            operatingMode: 'client',
            clientId: 'client-b',
            managedTenantId: null,
          },
        },
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        to: 'ig-scoped-user',
        text: 'não deve sair',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('normalizes browser audio before exposing it to the Instagram Send API', async () => {
    const harness = createHarness();
    process.env.API_PUBLIC_URL = 'https://api.example.com';
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          recipient_id: 'ig-scoped-user',
          message_id: 'ig-audio-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const browserFile = {
      originalname: 'audio.webm',
      mimetype: 'audio/webm;codecs=opus',
      buffer: Buffer.from('browser-audio'),
      size: 13,
    } as Express.Multer.File;

    try {
      const result = await harness.service.sendMedia({
        ctx: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        to: 'ig-scoped-user',
        file: browserFile,
        idempotencyKey: 'instagram-audio-1',
      });

      expect(harness.audioNormalizer.normalize).toHaveBeenCalledWith(
        browserFile,
      );
      expect(harness.filesService.uploadRawFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file: expect.objectContaining({
            originalname: 'audio.m4a',
            mimetype: 'audio/mp4',
          }),
        }),
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/ig-professional-account/messages'),
        expect.any(Object),
      );
      const request = (global.fetch as jest.Mock).mock
        .calls[0][1] as RequestInit;
      expect(JSON.parse(String(request.body))).toEqual({
        recipient: { id: 'ig-scoped-user' },
        message: {
          attachment: {
            type: 'audio',
            payload: {
              url: 'https://api.example.com/api/assets/audio/audio.m4a',
            },
          },
        },
      });
      expect(result.message.attachments).toEqual([
        expect.objectContaining({
          name: 'audio.m4a',
          mimeType: 'audio/mp4',
          kind: 'audio',
        }),
      ]);
    } finally {
      delete process.env.API_PUBLIC_URL;
    }
  });
});

function createHarness(channelOverrides: Partial<InboxChannelEntity> = {}) {
  const channel = {
    id: 'channel-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    type: 'instagram',
    provider: 'meta',
    status: 'active',
    connectionStatus: 'connected',
    externalAccountId: 'ig-professional-account',
    accessTokenEncrypted: 'encrypted-token',
    metadata: {},
    ...channelOverrides,
  } as InboxChannelEntity;
  const conversation = {
    id: 'conversation-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    channelId: 'channel-1',
    contactId: null,
    externalThreadId: 'instagram:ig-professional-account:ig-scoped-user',
    status: 'new',
    ownershipState: 'human_active',
    ownershipVersion: 2,
    aiEnabled: false,
    metadata: { externalParticipantId: 'ig-scoped-user' },
  } as unknown as InboxConversationEntity;
  const channelsRepository = {
    findOne: jest.fn().mockResolvedValue(channel),
  };
  const conversationsRepository = {
    findOne: jest.fn().mockResolvedValue(conversation),
  };
  let messageSequence = 0;
  const messagesRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn((value) => {
      if (!value.id) value.id = `message-${++messageSequence}`;
      return Promise.resolve(value);
    }),
  };
  const manager = {
    getRepository: jest.fn(() => ({
      save: jest.fn((value) => Promise.resolve(value)),
    })),
  };
  const dataSource = {
    transaction: jest.fn((callback) => callback(manager)),
    query: jest.fn(),
  };
  const metaLedger = {
    reserve: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
    started: jest.fn().mockResolvedValue(undefined),
    succeeded: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn().mockResolvedValue(undefined),
    replay: jest.fn().mockResolvedValue(undefined),
  };
  const normalizedAudio = {
    originalname: 'audio.m4a',
    mimetype: 'audio/mp4',
    buffer: Buffer.from('normalized-audio'),
    size: 16,
  } as Express.Multer.File;
  const audioNormalizer = {
    normalize: jest.fn().mockResolvedValue(normalizedAudio),
  };
  const filesService = {
    uploadRawFile: jest.fn().mockImplementation(({ file }) =>
      Promise.resolve({
        path: `audio/${file.originalname}`,
        url: `/api/assets/audio/${file.originalname}`,
      }),
    ),
  };
  const service = new InstagramOutboundService(
    dataSource as never,
    channelsRepository as never,
    conversationsRepository as never,
    messagesRepository as never,
    { decrypt: jest.fn().mockReturnValue('decrypted-token') } as never,
    filesService as never,
    metaLedger as never,
    audioNormalizer as never,
  );

  return {
    service,
    channel,
    conversation,
    messagesRepository,
    metaLedger,
    audioNormalizer,
    filesService,
  };
}
