import { InstagramMetaAdapter } from './instagram-meta.adapter';

describe('InstagramMetaAdapter', () => {
  const channel = {
    id: 'channel-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
  };
  const resolver = {
    findInstagramChannelByAccountId: jest.fn().mockResolvedValue(channel),
  };
  const adapter = new InstagramMetaAdapter(resolver as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes an inbound text message with channel ownership from the resolver', async () => {
    const result = await adapter.normalize({
      object: 'instagram',
      entry: [
        {
          id: 'ig-account-1',
          time: 1_720_000_000_000,
          messaging: [
            {
              sender: { id: 'ig-user-1', username: 'available_handle' },
              recipient: { id: 'ig-account-1' },
              timestamp: 1_720_000_001_000,
              message: { mid: 'ig-mid-1', text: 'Ola pelo Instagram' },
            },
          ],
        },
      ],
    });

    expect(resolver.findInstagramChannelByAccountId).toHaveBeenCalledWith(
      'ig-account-1',
    );
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      channelType: 'instagram',
      provider: 'meta',
      externalThreadId: 'instagram:ig-account-1:ig-user-1',
      externalMessageId: 'ig-mid-1',
      sender: {
        externalId: 'ig-user-1',
        username: 'available_handle',
      },
      messageType: 'text',
      content: 'Ola pelo Instagram',
      occurredAt: new Date(1_720_000_001_000),
    });
  });

  it('normalizes only supported media data without downloading it', async () => {
    const result = await adapter.normalize({
      object: 'instagram',
      entry: [
        {
          id: 'ig-account-1',
          messaging: [
            {
              sender: { id: 'ig-user-1' },
              recipient: { id: 'ig-account-1' },
              message: {
                mid: 'ig-mid-media',
                attachments: [
                  {
                    type: 'image',
                    payload: { url: 'https://lookaside.example/media' },
                  },
                  { type: 'share', payload: { url: 'https://example/share' } },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(result.messages[0]).toMatchObject({
      messageType: 'image',
      content: '[Imagem recebida]',
      attachments: [
        {
          type: 'image',
          url: 'https://lookaside.example/media',
          externalId: null,
        },
      ],
    });
  });

  it('ignores non-message and outbound/self events', async () => {
    const result = await adapter.normalize({
      object: 'instagram',
      entry: [
        {
          id: 'ig-account-1',
          messaging: [
            {
              sender: { id: 'ig-user-1' },
              recipient: { id: 'ig-account-1' },
            },
            {
              sender: { id: 'ig-account-1' },
              recipient: { id: 'ig-user-1' },
              message: { mid: 'outbound-mid', text: 'outbound' },
            },
            {
              sender: { id: 'ig-user-1' },
              recipient: { id: 'ig-account-1' },
              message: { mid: 'self-mid', text: 'self', is_self: true },
            },
          ],
        },
      ],
    });

    expect(result).toEqual({ messages: [] });
    expect(resolver.findInstagramChannelByAccountId).not.toHaveBeenCalled();
  });

  it.each([{}, { object: 'instagram' }, { object: 'instagram', entry: [{}] }])(
    'tolerates an empty payload envelope',
    async (payload) => {
      await expect(adapter.normalize(payload)).resolves.toEqual({
        messages: [],
      });
    },
  );

  it('tolerates optional message fields being absent without inventing identity data', async () => {
    const result = await adapter.normalize({
      object: 'instagram',
      entry: [
        {
          id: 'ig-account-1',
          messaging: [
            {
              sender: { id: 'ig-user-1' },
              recipient: { id: 'ig-account-1' },
              message: {},
            },
          ],
        },
      ],
    });

    expect(result.messages[0]).toMatchObject({
      externalMessageId: null,
      sender: { externalId: 'ig-user-1', username: null },
      messageType: 'unknown',
      content: '[Mensagem recebida]',
      attachments: [],
    });
    expect(result.messages[0].occurredAt).toBeInstanceOf(Date);
  });
});
