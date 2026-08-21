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
});
