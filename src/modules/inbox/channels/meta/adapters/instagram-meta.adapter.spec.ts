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
  const metaGraph = { getInstagramUserProfile: jest.fn() };
  const crypto = { decrypt: jest.fn().mockReturnValue(null) };
  const adapter = new InstagramMetaAdapter(
    resolver as never,
    metaGraph as never,
    crypto as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    crypto.decrypt.mockReturnValue(null);
    metaGraph.getInstagramUserProfile.mockReset();
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
          externalId: 'instagram:ig-mid-media:0',
        },
      ],
    });
  });

  it('enriches sender identity from the Instagram user profile API', async () => {
    crypto.decrypt.mockReturnValue('instagram-token');
    metaGraph.getInstagramUserProfile.mockResolvedValue({
      name: 'Maria Silva',
      username: 'maria.silva',
      profilePictureUrl: 'https://cdninstagram.com/profile.jpg',
    });

    const result = await adapter.normalize({
      object: 'instagram',
      entry: [
        {
          id: 'ig-account-1',
          messaging: [
            {
              sender: { id: 'ig-user-1' },
              recipient: { id: 'ig-account-1' },
              message: { mid: 'ig-mid-profile', text: 'Oi' },
            },
          ],
        },
      ],
    });

    expect(metaGraph.getInstagramUserProfile).toHaveBeenCalledWith({
      scopedUserId: 'ig-user-1',
      accessToken: 'instagram-token',
    });
    expect(result.messages[0].sender).toMatchObject({
      name: 'Maria Silva',
      username: 'maria.silva',
      metadata: {
        avatarUrl: 'https://cdninstagram.com/profile.jpg',
      },
    });
  });

  it('normalizes Instagram reactions and seen receipts', async () => {
    const payload = {
      object: 'instagram' as const,
      entry: [
        {
          id: 'ig-account-1',
          time: 1_720_000_000_000,
          messaging: [
            {
              sender: { id: 'ig-user-1' },
              recipient: { id: 'ig-account-1' },
              reaction: { mid: 'ig-mid-1', action: 'react', emoji: '❤' },
            },
            {
              sender: { id: 'ig-user-1' },
              recipient: { id: 'ig-account-1' },
              read: { mid: 'ig-mid-2' },
            },
          ],
        },
      ],
    };

    await expect(adapter.normalizeReactions(payload)).resolves.toMatchObject({
      reactions: [
        {
          externalMessageId: 'ig-mid-1',
          senderId: 'ig-user-1',
          action: 'react',
          emoji: '❤',
        },
      ],
    });
    await expect(adapter.normalizeStatuses(payload)).resolves.toMatchObject({
      statuses: [
        {
          externalMessageId: 'ig-mid-2',
          status: 'read',
          recipientId: 'ig-user-1',
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
