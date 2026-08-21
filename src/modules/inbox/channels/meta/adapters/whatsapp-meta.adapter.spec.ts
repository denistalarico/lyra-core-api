import { WhatsAppMetaAdapter } from './whatsapp-meta.adapter';

describe('WhatsAppMetaAdapter reactions', () => {
  const channel = {
    id: 'whatsapp-channel-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
  };
  const resolver = {
    findWhatsAppChannelByPhoneNumberId: jest.fn().mockResolvedValue(channel),
  };
  const adapter = new WhatsAppMetaAdapter(resolver as never);

  beforeEach(() => {
    jest.clearAllMocks();
    resolver.findWhatsAppChannelByPhoneNumberId.mockResolvedValue(channel);
  });

  function buildPayload(rawMessage: Record<string, unknown>) {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'phone-1' },
                messages: [rawMessage],
              },
            },
          ],
        },
      ],
    };
  }

  describe('normalize', () => {
    it('never ingests a reaction as an inbound message', async () => {
      const payload = buildPayload({
        from: '5511999990000',
        id: 'wamid-reaction-1',
        timestamp: '1720000000',
        type: 'reaction',
        reaction: { message_id: 'wamid-original-1', emoji: '🔥' },
      });

      const result = await adapter.normalize(payload);

      expect(result.messages).toEqual([]);
    });

    it('still ingests a regular text message alongside a reaction in the same batch', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'phone-1' },
                  messages: [
                    {
                      from: '5511999990000',
                      id: 'wamid-text-1',
                      timestamp: '1720000000',
                      type: 'text',
                      text: { body: 'Oi' },
                    },
                    {
                      from: '5511999990000',
                      id: 'wamid-reaction-1',
                      timestamp: '1720000001',
                      type: 'reaction',
                      reaction: { message_id: 'wamid-text-1', emoji: '👍' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await adapter.normalize(payload);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].externalMessageId).toBe('wamid-text-1');
    });
  });

  describe('normalizeReactions', () => {
    it('normalizes a react event with its emoji', async () => {
      const payload = buildPayload({
        from: '5511999990000',
        id: 'wamid-reaction-1',
        timestamp: '1720000000',
        type: 'reaction',
        reaction: { message_id: 'wamid-original-1', emoji: '🔥' },
      });

      const result = await adapter.normalizeReactions(payload);

      expect(resolver.findWhatsAppChannelByPhoneNumberId).toHaveBeenCalledWith(
        'phone-1',
      );
      expect(result.reactions).toEqual([
        expect.objectContaining({
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          channelId: 'whatsapp-channel-1',
          provider: 'meta',
          channelType: 'whatsapp',
          externalMessageId: 'wamid-original-1',
          senderId: '5511999990000',
          action: 'react',
          emoji: '🔥',
          occurredAt: new Date(1_720_000_000 * 1000),
        }),
      ]);
    });

    it('normalizes an unreact event when the emoji is removed', async () => {
      const payload = buildPayload({
        from: '5511999990000',
        id: 'wamid-reaction-2',
        timestamp: '1720000000',
        type: 'reaction',
        reaction: { message_id: 'wamid-original-1', emoji: '' },
      });

      const result = await adapter.normalizeReactions(payload);

      expect(result.reactions).toEqual([
        expect.objectContaining({ action: 'unreact', emoji: null }),
      ]);
    });

    it('ignores non-reaction messages', async () => {
      const payload = buildPayload({
        from: '5511999990000',
        id: 'wamid-text-1',
        timestamp: '1720000000',
        type: 'text',
        text: { body: 'Oi' },
      });

      const result = await adapter.normalizeReactions(payload);

      expect(result.reactions).toEqual([]);
    });

    it('ignores a reaction event missing the target message id', async () => {
      const payload = buildPayload({
        from: '5511999990000',
        id: 'wamid-reaction-1',
        timestamp: '1720000000',
        type: 'reaction',
        reaction: { emoji: '🔥' },
      });

      const result = await adapter.normalizeReactions(payload);

      expect(result.reactions).toEqual([]);
    });

    it('tolerates incomplete payload structures', async () => {
      await expect(
        adapter.normalizeReactions({ object: 'whatsapp_business_account' }),
      ).resolves.toEqual({ reactions: [] });
    });
  });

  describe('normalize — inbound messages', () => {
    it('normalizes a regular text message with the sender contact profile', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: {
                    phone_number_id: 'phone-1',
                    display_phone_number: '+55 11 99999-0000',
                  },
                  contacts: [
                    { wa_id: '5511999990000', profile: { name: 'Ana' } },
                  ],
                  messages: [
                    {
                      from: '5511999990000',
                      id: 'wamid-text-1',
                      timestamp: '1720000000',
                      type: 'text',
                      text: { body: 'Oi, tudo bem?' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await adapter.normalize(payload);

      expect(result.messages).toEqual([
        expect.objectContaining({
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          channelId: 'whatsapp-channel-1',
          channelType: 'whatsapp',
          provider: 'meta',
          externalThreadId: '5511999990000',
          externalMessageId: 'wamid-text-1',
          messageType: 'text',
          content: 'Oi, tudo bem?',
          attachments: [],
          sender: expect.objectContaining({
            externalId: '5511999990000',
            name: 'Ana',
            phone: '5511999990000',
          }),
          metadata: expect.objectContaining({
            whatsappMessageType: 'text',
            phoneNumberId: 'phone-1',
            referralTrusted: false,
            referral: null,
          }),
        }),
      ]);
    });

    it('normalizes an image message into a single attachment with its caption', async () => {
      const payload = buildPayload({
        from: '5511999990000',
        id: 'wamid-image-1',
        timestamp: '1720000000',
        type: 'image',
        image: {
          id: 'media-1',
          mime_type: 'image/jpeg',
          sha256: 'abc123',
          caption: 'Olha isso',
        },
      });

      const result = await adapter.normalize(payload);

      expect(result.messages[0]).toMatchObject({
        messageType: 'image',
        content: 'Olha isso',
        attachments: [
          {
            type: 'image',
            externalId: 'media-1',
            mimeType: 'image/jpeg',
            metadata: { sha256: 'abc123', caption: 'Olha isso' },
          },
        ],
      });
    });

    it('carries ad referral data into metadata when present', async () => {
      const payload = buildPayload({
        from: '5511999990000',
        id: 'wamid-referral-1',
        timestamp: '1720000000',
        type: 'text',
        text: { body: 'Vim do anúncio' },
        referral: {
          source_id: 'ad-1',
          source_type: 'ad',
          ctwa_clid: 'click-1',
        },
      });

      const result = await adapter.normalize(payload);

      expect(result.messages[0].metadata).toMatchObject({
        referralTrusted: true,
        referral: {
          adId: 'ad-1',
          sourceType: 'ad',
          clickId: 'click-1',
        },
      });
    });

    it('falls back to a generic label and unknown type for an unrecognized message type', async () => {
      const payload = buildPayload({
        from: '5511999990000',
        id: 'wamid-unknown-1',
        timestamp: '1720000000',
        type: 'sticker',
      });

      const result = await adapter.normalize(payload);

      expect(result.messages[0]).toMatchObject({
        messageType: 'unknown',
        content: '[Mensagem recebida]',
        attachments: [],
      });
    });

    it('ignores a messages change with no phone_number_id or no messages', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              { field: 'messages', value: { metadata: {}, messages: [] } },
            ],
          },
        ],
      };

      const result = await adapter.normalize(payload);

      expect(result.messages).toEqual([]);
      expect(resolver.findWhatsAppChannelByPhoneNumberId).not.toHaveBeenCalled();
    });
  });

  describe('normalizeStatuses', () => {
    it.each([
      ['sent', 'sent'],
      ['delivered', 'delivered'],
      ['read', 'read'],
      ['failed', 'failed'],
      ['deleted', 'unknown'],
    ])('maps provider status %s to %s', async (providerStatus, mapped) => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'phone-1' },
                  statuses: [
                    {
                      id: 'wamid-status-1',
                      status: providerStatus,
                      timestamp: '1720000000',
                      recipient_id: '5511999990000',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await adapter.normalizeStatuses(payload);

      expect(result.statuses).toEqual([
        expect.objectContaining({
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          channelId: 'whatsapp-channel-1',
          provider: 'meta',
          channelType: 'whatsapp',
          externalMessageId: 'wamid-status-1',
          status: mapped,
          recipientId: '5511999990000',
          occurredAt: new Date(1_720_000_000 * 1000),
        }),
      ]);
    });

    it('ignores a status entry missing its message id', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-1',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: 'phone-1' },
                  statuses: [{ status: 'delivered', timestamp: '1720000000' }],
                },
              },
            ],
          },
        ],
      };

      const result = await adapter.normalizeStatuses(payload);

      expect(result.statuses).toEqual([]);
    });

    it('ignores a messages change with no statuses', async () => {
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

      const result = await adapter.normalizeStatuses(payload);

      expect(result.statuses).toEqual([]);
      expect(resolver.findWhatsAppChannelByPhoneNumberId).not.toHaveBeenCalled();
    });

    it('tolerates incomplete payload structures', async () => {
      await expect(
        adapter.normalizeStatuses({ object: 'whatsapp_business_account' }),
      ).resolves.toEqual({ statuses: [] });
    });
  });
});
