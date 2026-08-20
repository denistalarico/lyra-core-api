/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- focused service/repository doubles expose dynamic Jest values */
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../../../entities/inbox-message.entity';
import {
  FACEBOOK_MESSENGER_WINDOW_CLOSED,
  FacebookMessengerOutboundService,
} from './facebook-messenger-outbound.service';

const SEND_URL = 'https://graph.facebook.com/v24.0/page-1/messages';

describe('FacebookMessengerOutboundService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('text', () => {
    it('delivers text to the Page Messages API and persists the Meta message id', async () => {
      const harness = createHarness();
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const fetchMock = jest
        .fn()
        .mockResolvedValue(
          okResponse({ recipient_id: 'psid-1', message_id: 'mid-out-1' }),
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
        to: 'psid-1',
        text: 'Olá pelo Messenger',
        idempotencyKey: 'messenger-text-1',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        SEND_URL,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer decrypted-token',
          }),
          body: JSON.stringify({
            recipient: { id: 'psid-1' },
            messaging_type: 'RESPONSE',
            message: { text: 'Olá pelo Messenger' },
          }),
        }),
      );
      expect(fetchMock.mock.calls[0][0]).not.toContain('access_token');
      expect(result.message).toMatchObject({
        externalMessageId: 'mid-out-1',
        status: 'sent',
        content: 'Olá pelo Messenger',
      });
      expect(harness.conversation).toMatchObject({
        status: 'open',
        lastMessagePreview: 'Olá pelo Messenger',
      });
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('marks the message failed and keeps the Meta diagnostics sanitized', async () => {
      const harness = createHarness();
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message:
                'Permission denied. Authorization: Bearer decrypted-token; recipient=psid-1; app_secret=meta-app-secret; oauth_code=private-oauth-code; credentialsEncrypted=encrypted-token; channelId=channel-1; conversationId=conversation-1; https://graph.facebook.com/v24.0/page-1/messages?access_token=decrypted-token',
              type: 'OAuthException',
              code: 100,
              error_subcode: 2018001,
              fbtrace_id: 'private-trace',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const error = await harness.service
        .sendText({
          ctx: {
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
          },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          text: 'Olá',
        })
        .catch((caught: unknown) => caught);

      expect(error).toEqual(
        new BadRequestException(
          'Não foi possível enviar pelo canal Messenger.',
        ),
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Meta Messenger outbound failed',
        expect.objectContaining({
          operation: 'sendFacebookMessengerMessage',
          status: 400,
          type: 'OAuthException',
          code: 100,
          subcode: 2018001,
        }),
      );

      const diagnostic = loggerErrorSpy.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(Object.keys(diagnostic).sort()).toEqual(
        ['operation', 'status', 'type', 'code', 'subcode', 'message'].sort(),
      );
      const serializedLog = JSON.stringify(loggerErrorSpy.mock.calls);
      for (const sensitiveValue of [
        'decrypted-token',
        'psid-1',
        'Authorization',
        'meta-app-secret',
        'private-oauth-code',
        'encrypted-token',
        'channel-1',
        'conversation-1',
        'page-1',
        'private-trace',
      ]) {
        expect(serializedLog).not.toContain(sensitiveValue);
      }
      expect(harness.savedMessages.at(-1)).toMatchObject({
        status: 'failed',
        metadata: expect.objectContaining({
          errorCode: 'provider_send_failed',
        }),
      });
    });

    it('replays an idempotent send without calling Meta twice', async () => {
      const harness = createHarness();
      global.fetch = jest
        .fn()
        .mockResolvedValue(okResponse({ message_id: 'mid-out-1' }));
      const input = {
        ctx: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        to: 'psid-1',
        text: 'Olá',
        idempotencyKey: 'messenger-text-replay',
      };

      const first = await harness.service.sendText(input);
      harness.messagesRepository.findOne.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            where.direction === 'inbound'
              ? lastInboundMessage()
              : where.idempotencyKey === 'messenger-text-replay'
                ? first.message
                : null,
          ),
      );
      const replay = await harness.service.sendText(input);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(replay.message.id).toBe(first.message.id);
      expect(harness.metaLedger.replay).toHaveBeenCalledTimes(1);
    });
  });

  describe('reply', () => {
    it('sends message.reply_to.mid when the quoted message carries a Meta id', async () => {
      const harness = createHarness();
      harness.messagesRepository.findOne.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            where.id === 'reply-target'
              ? ({
                  id: 'reply-target',
                  content: 'Mensagem original',
                  externalMessageId: 'mid-inbound-9',
                } as InboxMessageEntity)
              : where.direction === 'inbound'
                ? lastInboundMessage()
                : null,
          ),
      );
      global.fetch = jest
        .fn()
        .mockResolvedValue(okResponse({ message_id: 'mid-out-2' }));

      const result = await harness.service.sendText({
        ctx: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        to: 'psid-1',
        text: 'Respondendo',
        replyToMessageId: 'reply-target',
      });

      const request = (global.fetch as jest.Mock).mock
        .calls[0][1] as RequestInit;
      expect(JSON.parse(String(request.body))).toEqual({
        recipient: { id: 'psid-1' },
        messaging_type: 'RESPONSE',
        message: {
          text: 'Respondendo',
          reply_to: { mid: 'mid-inbound-9' },
        },
      });
      expect(result.message.metadata).toMatchObject({
        replyToMessageId: 'reply-target',
        nativeReplySupported: true,
      });
    });

    it('keeps the quote local when the target has no Meta id', async () => {
      const harness = createHarness();
      harness.messagesRepository.findOne.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            where.id === 'reply-target'
              ? ({
                  id: 'reply-target',
                  content: 'Nota interna',
                  externalMessageId: null,
                } as InboxMessageEntity)
              : where.direction === 'inbound'
                ? lastInboundMessage()
                : null,
          ),
      );
      global.fetch = jest
        .fn()
        .mockResolvedValue(okResponse({ message_id: 'mid-out-3' }));

      const result = await harness.service.sendText({
        ctx: {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        to: 'psid-1',
        text: 'Respondendo',
        replyToMessageId: 'reply-target',
      });

      const request = (global.fetch as jest.Mock).mock
        .calls[0][1] as RequestInit;
      expect(JSON.parse(String(request.body)).message).toEqual({
        text: 'Respondendo',
      });
      expect(result.message.metadata).toMatchObject({
        nativeReplySupported: false,
      });
    });
  });

  describe('standard messaging window', () => {
    it('blocks the send when the last inbound message is older than 24 hours', async () => {
      const harness = createHarness();
      harness.messagesRepository.findOne.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            where.direction === 'inbound'
              ? lastInboundMessage(Date.now() - 25 * 60 * 60 * 1_000)
              : null,
          ),
      );
      global.fetch = jest.fn();

      await expect(
        harness.service.sendText({
          ctx: {
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
          },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          text: 'fora da janela',
        }),
      ).rejects.toEqual(
        new ConflictException(FACEBOOK_MESSENGER_WINDOW_CLOSED),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks the send when the contact never wrote', async () => {
      const harness = createHarness();
      harness.messagesRepository.findOne.mockResolvedValue(null);
      global.fetch = jest.fn();

      await expect(
        harness.service.sendText({
          ctx: {
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
          },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          text: 'sem janela aberta',
        }),
      ).rejects.toEqual(
        new ConflictException(FACEBOOK_MESSENGER_WINDOW_CLOSED),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks media the same way as text', async () => {
      const harness = createHarness();
      harness.messagesRepository.findOne.mockResolvedValue(null);
      global.fetch = jest.fn();

      await expect(
        harness.service.sendMedia({
          ctx: {
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
          },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          file: multerFile('foto.jpg', 'image/jpeg'),
        }),
      ).rejects.toEqual(
        new ConflictException(FACEBOOK_MESSENGER_WINDOW_CLOSED),
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('channel availability', () => {
    it.each([
      ['disconnected', { connectionStatus: 'disconnected' }],
      ['suspended', { status: 'suspended' }],
    ])('refuses to send when the channel is %s', async (_case, overrides) => {
      // The repository filter pins status/connectionStatus, so an unavailable
      // channel simply does not resolve.
      const harness = createHarness(overrides as Partial<InboxChannelEntity>);
      harness.channelsRepository.findOne.mockResolvedValue(null);
      global.fetch = jest.fn();

      await expect(
        harness.service.sendText({
          ctx: {
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
          },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          text: 'não deve sair',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('refuses to send when the stored credential cannot be decrypted', async () => {
      const harness = createHarness();
      harness.cryptoService.decrypt.mockReturnValue(null);
      global.fetch = jest.fn();

      await expect(
        harness.service.sendText({
          ctx: {
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
          },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          text: 'não deve sair',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(global.fetch).not.toHaveBeenCalled();
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
          to: 'psid-1',
          text: 'não deve sair',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('recipient', () => {
    it('derives the PSID from the canonical thread when the caller sends it', async () => {
      const harness = createHarness();
      global.fetch = jest
        .fn()
        .mockResolvedValue(okResponse({ message_id: 'mid-out-4' }));

      await harness.service.sendText({
        ctx: { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
        channelId: 'channel-1',
        conversationId: 'conversation-1',
        to: harness.conversation.externalThreadId!,
        text: 'via thread canônica',
      });

      const request = (global.fetch as jest.Mock).mock
        .calls[0][1] as RequestInit;
      expect(JSON.parse(String(request.body)).recipient).toEqual({
        id: 'psid-1',
      });
    });

    it.each([
      [
        'the PSID is missing from both metadata and thread',
        { externalThreadId: null, metadata: {} },
      ],
      [
        'the caller supplies a different participant',
        { metadata: { externalParticipantId: 'psid-other' } },
      ],
      [
        'the thread belongs to another channel family',
        { externalThreadId: 'instagram:page-1:ig-scoped-user', metadata: {} },
      ],
    ])('refuses to send when %s', async (_case, conversationOverrides) => {
      const harness = createHarness(undefined, conversationOverrides);
      global.fetch = jest.fn();

      await expect(
        harness.service.sendText({
          ctx: { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          text: 'não deve sair',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('never lets the Page message itself', async () => {
      const harness = createHarness(undefined, {
        externalThreadId: 'facebook_messenger:page-1:page-1',
        metadata: { externalParticipantId: 'page-1' },
      });
      global.fetch = jest.fn();

      await expect(
        harness.service.sendText({
          ctx: { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'page-1',
          text: 'não deve sair',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('media', () => {
    it.each([
      ['image', 'foto.jpg', 'image/jpeg'],
      ['video', 'clipe.mp4', 'video/mp4'],
      ['file', 'contrato.pdf', 'application/pdf'],
    ])(
      'sends %s as a URL attachment and persists the Meta id',
      async (expectedType, fileName, mimeType) => {
        const harness = createHarness();
        process.env.API_PUBLIC_URL = 'https://api.example.com';
        global.fetch = jest
          .fn()
          .mockResolvedValue(okResponse({ message_id: `mid-${expectedType}` }));

        try {
          const result = await harness.service.sendMedia({
            ctx: {
              tenantId: 'tenant-1',
              workspaceId: 'workspace-1',
              userId: 'user-1',
            },
            channelId: 'channel-1',
            conversationId: 'conversation-1',
            to: 'psid-1',
            file: multerFile(fileName, mimeType),
          });

          const request = (global.fetch as jest.Mock).mock
            .calls[0][1] as RequestInit;
          expect(JSON.parse(String(request.body))).toEqual({
            recipient: { id: 'psid-1' },
            messaging_type: 'RESPONSE',
            message: {
              attachment: {
                type: expectedType,
                payload: {
                  url: `https://api.example.com/api/assets/${fileName}`,
                },
              },
            },
          });
          expect(result.message).toMatchObject({
            externalMessageId: `mid-${expectedType}`,
            status: 'sent',
          });
          expect(result.message.attachments).toEqual([
            expect.objectContaining({ name: fileName, kind: expectedType }),
          ]);
        } finally {
          delete process.env.API_PUBLIC_URL;
        }
      },
    );

    it('normalizes browser audio to AAC before exposing the URL to Meta', async () => {
      const harness = createHarness();
      process.env.API_PUBLIC_URL = 'https://api.example.com';
      global.fetch = jest
        .fn()
        .mockResolvedValue(okResponse({ message_id: 'mid-audio' }));
      const browserFile = multerFile('audio.webm', 'audio/webm;codecs=opus');

      try {
        await harness.service.sendMedia({
          ctx: {
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
          },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          file: browserFile,
        });

        expect(harness.audioNormalizer.normalize).toHaveBeenCalledWith(
          browserFile,
        );
        const request = (global.fetch as jest.Mock).mock
          .calls[0][1] as RequestInit;
        expect(JSON.parse(String(request.body)).message).toEqual({
          attachment: {
            type: 'audio',
            payload: { url: 'https://api.example.com/api/assets/audio.m4a' },
          },
        });
      } finally {
        delete process.env.API_PUBLIC_URL;
      }
    });

    it('refuses to send media when no public API origin is configured', async () => {
      const harness = createHarness();
      const previous = {
        api: process.env.API_PUBLIC_URL,
        agency: process.env.AGENCY_PUBLIC_API_URL,
        webhook: process.env.META_WEBHOOK_CALLBACK_URL,
      };
      delete process.env.API_PUBLIC_URL;
      delete process.env.AGENCY_PUBLIC_API_URL;
      delete process.env.META_WEBHOOK_CALLBACK_URL;
      global.fetch = jest.fn();

      try {
        await expect(
          harness.service.sendMedia({
            ctx: {
              tenantId: 'tenant-1',
              workspaceId: 'workspace-1',
              userId: 'user-1',
            },
            channelId: 'channel-1',
            conversationId: 'conversation-1',
            to: 'psid-1',
            file: multerFile('foto.jpg', 'image/jpeg'),
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        if (previous.api) process.env.API_PUBLIC_URL = previous.api;
        if (previous.agency)
          process.env.AGENCY_PUBLIC_API_URL = previous.agency;
        if (previous.webhook) {
          process.env.META_WEBHOOK_CALLBACK_URL = previous.webhook;
        }
      }
    });
  });

  describe('reaction', () => {
    it('sends the emoji verbatim through the documented sender_action payload', async () => {
      const harness = createHarness();
      const fetchMock = jest.fn().mockResolvedValue(okResponse({}));
      global.fetch = fetchMock;

      await expect(
        harness.service.deliverReaction({
          conversation: harness.conversation,
          message: {
            channelId: 'channel-1',
            externalMessageId: 'mid-inbound-1',
          } as InboxMessageEntity,
          emoji: '🎉',
        }),
      ).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledWith(
        SEND_URL,
        expect.objectContaining({
          body: JSON.stringify({
            recipient: { id: 'psid-1' },
            sender_action: 'react',
            payload: { message_id: 'mid-inbound-1', reaction: '🎉' },
          }),
        }),
      );
    });

    it('removes a reaction with unreact and no reaction field', async () => {
      const harness = createHarness();
      const fetchMock = jest.fn().mockResolvedValue(okResponse({}));
      global.fetch = fetchMock;

      await expect(
        harness.service.deliverReaction({
          conversation: harness.conversation,
          message: {
            channelId: 'channel-1',
            externalMessageId: 'mid-inbound-1',
          } as InboxMessageEntity,
          emoji: '',
        }),
      ).resolves.toBe(true);

      const request = fetchMock.mock.calls[0][1] as RequestInit;
      expect(JSON.parse(String(request.body))).toEqual({
        recipient: { id: 'psid-1' },
        sender_action: 'unreact',
        payload: { message_id: 'mid-inbound-1' },
      });
    });

    it('reports no delivery when the target message has no Meta id', async () => {
      const harness = createHarness();
      global.fetch = jest.fn();

      await expect(
        harness.service.deliverReaction({
          conversation: harness.conversation,
          message: {
            channelId: 'channel-1',
            externalMessageId: null,
          } as InboxMessageEntity,
          emoji: '🎉',
        }),
      ).resolves.toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('ownership', () => {
    it('requires a human owner before a user reply leaves the platform', async () => {
      const harness = createHarness(undefined, { ownershipState: 'ai_active' });
      global.fetch = jest.fn();

      await expect(
        harness.service.sendText({
          ctx: {
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
          },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          text: 'não deve sair',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('blocks an agent reply that no governed action authorized', async () => {
      const harness = createHarness(undefined, {
        ownershipState: 'ai_active',
        aiEnabled: true,
      });
      harness.dataSource.query.mockResolvedValue([]);
      global.fetch = jest.fn();

      await expect(
        harness.service.sendAgentText({
          ctx: { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
          channelId: 'channel-1',
          conversationId: 'conversation-1',
          to: 'psid-1',
          text: 'não deve sair',
          idempotencyKey: 'agent-1',
          agentId: 'agent-1',
          ownershipVersion: 2,
          decisionId: 'decision-1',
          policyVersion: 'v1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

function okResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function multerFile(originalname: string, mimetype: string) {
  return {
    originalname,
    mimetype,
    buffer: Buffer.from('binary'),
    size: 6,
  } as Express.Multer.File;
}

function lastInboundMessage(occurredAtMs = Date.now() - 60_000) {
  return {
    id: 'inbound-1',
    occurredAt: new Date(occurredAtMs),
  } as InboxMessageEntity;
}

function createHarness(
  channelOverrides: Partial<InboxChannelEntity> = {},
  conversationOverrides: Partial<InboxConversationEntity> = {},
) {
  const channel = {
    id: 'channel-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    type: 'facebook_messenger',
    provider: 'meta',
    status: 'active',
    connectionStatus: 'connected',
    externalAccountId: 'page-1',
    externalPageId: 'page-1',
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
    source: 'facebook_messenger',
    externalThreadId: 'facebook_messenger:page-1:psid-1',
    status: 'new',
    ownershipState: 'human_active',
    ownershipVersion: 2,
    aiEnabled: false,
    metadata: { externalParticipantId: 'psid-1' },
    ...conversationOverrides,
  } as unknown as InboxConversationEntity;
  const channelsRepository = {
    findOne: jest.fn().mockResolvedValue(channel),
  };
  const conversationsRepository = {
    findOne: jest.fn().mockResolvedValue(conversation),
  };
  const savedMessages: InboxMessageEntity[] = [];
  let messageSequence = 0;
  const messagesRepository = {
    // The window lookup and the idempotency lookup share this double: only the
    // inbound probe resolves, so by default the conversation is inside the
    // 24-hour window and no previous send exists.
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        where.direction === 'inbound' ? lastInboundMessage() : null,
      ),
    ),
    create: jest.fn((value) => value),
    save: jest.fn((value) => {
      if (!value.id) value.id = `message-${++messageSequence}`;
      savedMessages.push(value);
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
    query: jest.fn().mockResolvedValue([]),
  };
  const metaLedger = {
    reserve: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
    started: jest.fn().mockResolvedValue(undefined),
    succeeded: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn().mockResolvedValue(undefined),
    replay: jest.fn().mockResolvedValue(undefined),
  };
  const audioNormalizer = {
    normalize: jest.fn().mockResolvedValue({
      originalname: 'audio.m4a',
      mimetype: 'audio/mp4',
      buffer: Buffer.from('normalized-audio'),
      size: 16,
    } as Express.Multer.File),
  };
  const filesService = {
    uploadRawFile: jest.fn().mockImplementation(({ file }) =>
      Promise.resolve({
        path: `assets/${file.originalname}`,
        url: `/api/assets/${file.originalname}`,
      }),
    ),
  };
  const cryptoService = {
    decrypt: jest.fn().mockReturnValue('decrypted-token'),
  };
  const service = new FacebookMessengerOutboundService(
    dataSource as never,
    channelsRepository as never,
    conversationsRepository as never,
    messagesRepository as never,
    cryptoService as never,
    filesService as never,
    metaLedger as never,
    audioNormalizer as never,
  );

  return {
    service,
    channel,
    conversation,
    channelsRepository,
    messagesRepository,
    savedMessages,
    dataSource,
    metaLedger,
    audioNormalizer,
    filesService,
    cryptoService,
  };
}
