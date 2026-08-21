import { MessengerMetaAdapter } from './messenger-meta.adapter';
import { MetaChannelUnavailableError } from '../services/meta-channel-resolver.service';

describe('MessengerMetaAdapter', () => {
  const channel = {
    id: 'messenger-channel-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    accessTokenEncrypted: 'encrypted-page-token',
  };
  const resolver = {
    findFacebookMessengerChannelByPageId: jest.fn().mockResolvedValue(channel),
  };
  const metaGraphService = {
    getFacebookMessengerUserProfile: jest.fn(),
  };
  const cryptoService = {
    decrypt: jest.fn(),
  };
  const adapter = new MessengerMetaAdapter(
    resolver as never,
    metaGraphService as never,
    cryptoService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    resolver.findFacebookMessengerChannelByPageId.mockResolvedValue(channel);
    cryptoService.decrypt.mockReturnValue('page-secret-1');
    metaGraphService.getFacebookMessengerUserProfile.mockResolvedValue({
      id: 'psid-1',
      name: 'Maria Silva',
      profilePictureUrl: 'https://cdn.example.com/avatar.jpg',
    });
  });

  it('normalizes a valid inbound text message with Page and PSID isolation', async () => {
    const result = await adapter.normalize({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          time: 1_720_000_000_000,
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'page-1' },
              timestamp: 1_720_000_001_000,
              message: { mid: 'mid-1', text: 'Olá' },
            },
          ],
        },
      ],
    });

    expect(resolver.findFacebookMessengerChannelByPageId).toHaveBeenCalledWith(
      'page-1',
    );
    expect(result.messages).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        channelId: 'messenger-channel-1',
        channelType: 'facebook_messenger',
        provider: 'meta',
        externalThreadId: 'facebook_messenger:page-1:psid-1',
        externalMessageId: 'mid-1',
        sender: {
          externalId: 'psid-1',
          name: 'Maria Silva',
          username: null,
          metadata: {
            facebookPageScopedId: 'psid-1',
            avatarUrl: 'https://cdn.example.com/avatar.jpg',
          },
        },
        messageType: 'text',
        content: 'Olá',
        attachments: [],
        occurredAt: new Date(1_720_000_001_000),
        metadata: {
          metaObject: 'page',
          facebookPageId: 'page-1',
          recipientId: 'page-1',
        },
      }),
    ]);
    expect(result.messages[0].sender).not.toHaveProperty('phone');
    expect(result.messages[0].sender).not.toHaveProperty('email');
    expect(cryptoService.decrypt).toHaveBeenCalledWith('encrypted-page-token');
    expect(
      metaGraphService.getFacebookMessengerUserProfile,
    ).toHaveBeenCalledWith({
      pageScopedUserId: 'psid-1',
      pageAccessToken: 'page-secret-1',
    });
    expect(JSON.stringify(result.messages)).not.toContain('page-secret-1');
    expect(JSON.stringify(result.messages)).not.toContain(
      'encrypted-page-token',
    );
  });

  it('looks the sender profile up once per participant in a batched delivery', async () => {
    const result = await adapter.normalize({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              message: { mid: 'mid-1', text: 'Primeira' },
            },
            {
              sender: { id: 'psid-1' },
              message: { mid: 'mid-2', text: 'Segunda' },
            },
          ],
        },
      ],
    });

    expect(
      metaGraphService.getFacebookMessengerUserProfile,
    ).toHaveBeenCalledTimes(1);
    expect(result.messages.map((message) => message.sender.name)).toEqual([
      'Maria Silva',
      'Maria Silva',
    ]);
    expect(
      result.messages.map((message) => message.sender.metadata?.avatarUrl),
    ).toEqual([
      'https://cdn.example.com/avatar.jpg',
      'https://cdn.example.com/avatar.jpg',
    ]);
  });

  it.each([
    [
      'the profile lookup fails',
      () => {
        metaGraphService.getFacebookMessengerUserProfile.mockRejectedValue(
          new Error('Facebook Messenger user profile lookup failed.'),
        );
      },
    ],
    [
      'the stored credential cannot be decrypted',
      () => {
        cryptoService.decrypt.mockReturnValue(null);
      },
    ],
    [
      'decryption throws',
      () => {
        cryptoService.decrypt.mockImplementation(() => {
          throw new Error('invalid key');
        });
      },
    ],
  ])('still ingests the message when %s', async (_case, arrange) => {
    arrange();

    const result = await adapter.normalize({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              message: { mid: 'mid-1', text: 'Olá' },
            },
          ],
        },
      ],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Olá');
    expect(result.messages[0].sender).toEqual({
      externalId: 'psid-1',
      name: null,
      username: null,
      metadata: { facebookPageScopedId: 'psid-1', avatarUrl: null },
    });
  });

  it('never derives a username from the Page-scoped id', async () => {
    metaGraphService.getFacebookMessengerUserProfile.mockResolvedValue({
      id: 'psid-1',
      name: null,
      profilePictureUrl: null,
    });

    const result = await adapter.normalize({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              message: { mid: 'mid-1', text: 'Olá' },
            },
          ],
        },
      ],
    });

    expect(result.messages[0].sender.username).toBeNull();
  });

  it('normalizes multiple valid messages', async () => {
    const result = await adapter.normalize({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              message: { mid: 'mid-1', text: 'Primeira' },
            },
            {
              sender: { id: 'psid-2' },
              message: { mid: 'mid-2', text: 'Segunda' },
            },
          ],
        },
      ],
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((message) => message.externalMessageId)).toEqual(
      ['mid-1', 'mid-2'],
    );
  });

  it('ignores echo messages', async () => {
    const result = await adapter.normalize({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'page-1' },
              message: { mid: 'mid-echo', text: 'Echo', is_echo: true },
            },
          ],
        },
      ],
    });

    expect(result.messages).toEqual([]);
    expect(
      resolver.findFacebookMessengerChannelByPageId,
    ).not.toHaveBeenCalled();
  });

  it.each([
    {
      sender: { id: 'psid-1' },
      message: { mid: 'mid-attachment' },
    },
    {
      sender: { id: 'psid-1' },
      message: { mid: 'mid-empty', text: '   ' },
    },
    { sender: { id: 'psid-1' }, message: { text: 'Sem MID' } },
    { sender: {}, message: { mid: 'mid-no-sender', text: 'Sem sender' } },
    { sender: { id: 'psid-1' } },
  ])('ignores unsupported or malformed event %#', async (event) => {
    const result = await adapter.normalize({
      object: 'page',
      entry: [{ id: 'page-1', messaging: [event] }],
    });

    expect(result.messages).toEqual([]);
  });

  it('tolerates incomplete payload structures', async () => {
    await expect(adapter.normalize({ object: 'page' })).resolves.toEqual({
      messages: [],
    });
    await expect(
      adapter.normalize({ object: 'page', entry: [{ messaging: [] }] }),
    ).resolves.toEqual({ messages: [] });
  });

  describe('normalizeReactions', () => {
    it('normalizes a react event with its emoji', async () => {
      const result = await adapter.normalizeReactions({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            time: 1_720_000_000_000,
            messaging: [
              {
                sender: { id: 'psid-1' },
                recipient: { id: 'page-1' },
                timestamp: 1_720_000_001_000,
                reaction: {
                  mid: 'mid-1',
                  action: 'react',
                  reaction: 'love',
                  emoji: '😍',
                },
              },
            ],
          },
        ],
      });

      expect(
        resolver.findFacebookMessengerChannelByPageId,
      ).toHaveBeenCalledWith('page-1');
      expect(result.reactions).toEqual([
        expect.objectContaining({
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          channelId: 'messenger-channel-1',
          provider: 'meta',
          channelType: 'facebook_messenger',
          externalMessageId: 'mid-1',
          senderId: 'psid-1',
          action: 'react',
          emoji: '😍',
          occurredAt: new Date(1_720_000_001_000),
        }),
      ]);
    });

    it('normalizes an unreact event', async () => {
      const result = await adapter.normalizeReactions({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [
              {
                sender: { id: 'psid-1' },
                reaction: { mid: 'mid-1', action: 'unreact' },
              },
            ],
          },
        ],
      });

      expect(result.reactions).toEqual([
        expect.objectContaining({ action: 'unreact', emoji: null }),
      ]);
    });

    it('ignores events without a reaction or a target message id', async () => {
      const result = await adapter.normalizeReactions({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [
              { sender: { id: 'psid-1' }, message: { mid: 'mid-1' } },
              { sender: { id: 'psid-1' }, reaction: {} },
            ],
          },
        ],
      });

      expect(result.reactions).toEqual([]);
    });

    it('tolerates incomplete payload structures', async () => {
      await expect(
        adapter.normalizeReactions({ object: 'page' }),
      ).resolves.toEqual({ reactions: [] });
    });
  });

  describe('normalizeEchoes', () => {
    it('normalizes an is_echo event as a message pointed at the contact thread', async () => {
      const result = await adapter.normalizeEchoes({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            time: 1_720_000_000_000,
            messaging: [
              {
                sender: { id: 'page-1' },
                recipient: { id: 'psid-1' },
                timestamp: 1_720_000_001_000,
                message: { mid: 'mid-echo-1', text: 'Olá', is_echo: true },
              },
            ],
          },
        ],
      });

      expect(
        resolver.findFacebookMessengerChannelByPageId,
      ).toHaveBeenCalledWith('page-1');
      expect(result.messages).toEqual([
        expect.objectContaining({
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          channelId: 'messenger-channel-1',
          channelType: 'facebook_messenger',
          provider: 'meta',
          externalThreadId: 'facebook_messenger:page-1:psid-1',
          externalMessageId: 'mid-echo-1',
          content: 'Olá',
          occurredAt: new Date(1_720_000_001_000),
        }),
      ]);
    });

    it('ignores non-echo messages', async () => {
      const result = await adapter.normalizeEchoes({
        object: 'page',
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
      });

      expect(result.messages).toEqual([]);
      expect(
        resolver.findFacebookMessengerChannelByPageId,
      ).not.toHaveBeenCalled();
    });

    it('tolerates incomplete payload structures', async () => {
      await expect(
        adapter.normalizeEchoes({ object: 'page' }),
      ).resolves.toEqual({ messages: [] });
    });
  });

  it('preserves MetaChannelUnavailableError from the resolver', async () => {
    const unavailableChannel = {
      ...channel,
      connectionStatus: 'suspended',
    };
    resolver.findFacebookMessengerChannelByPageId.mockRejectedValueOnce(
      new MetaChannelUnavailableError(unavailableChannel as never),
    );

    await expect(
      adapter.normalize({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            messaging: [
              {
                sender: { id: 'psid-1' },
                message: { mid: 'mid-1', text: 'Olá' },
              },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'meta_channel_unavailable',
      channel: unavailableChannel,
    });
  });
});
