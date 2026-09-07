import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InstagramContactEnrichmentService } from './instagram-contact-enrichment.service';

describe('InstagramContactEnrichmentService', () => {
  it('backfills a missing profile and replaces its placeholder title', async () => {
    const channel = {
      id: 'channel-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      accessTokenEncrypted: 'encrypted-token',
      metadata: { authorizationMethod: 'facebook_login' },
    } as unknown as InboxChannelEntity;
    const conversation = {
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      source: 'instagram',
      externalThreadId: 'instagram:account-1:scoped-user-1',
      title: 'Lead do Instagram',
      metadata: { externalParticipantId: 'scoped-user-1' },
    } as unknown as InboxConversationEntity;
    const conversationsRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const metaGraphService = {
      getFacebookInstagramUserProfile: jest.fn().mockResolvedValue({
        id: 'scoped-user-1',
        name: 'Maria Silva',
        username: 'maria.silva',
        profilePictureUrl: 'https://cdn.example.com/new-avatar.jpg',
      }),
      getInstagramUserProfile: jest.fn(),
    };
    const service = new InstagramContactEnrichmentService(
      { find: jest.fn().mockResolvedValue([channel]) } as never,
      conversationsRepository as never,
      { decrypt: jest.fn().mockReturnValue('page-access-token') } as never,
      metaGraphService as never,
    );

    await service.refreshProfiles([conversation]);

    expect(
      metaGraphService.getFacebookInstagramUserProfile,
    ).toHaveBeenCalledWith({
      scopedUserId: 'scoped-user-1',
      pageAccessToken: 'page-access-token',
    });
    expect(conversationsRepository.update).toHaveBeenCalledWith(
      {
        id: 'conversation-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
      },
      expect.objectContaining({
        title: 'Maria Silva',
        metadata: expect.objectContaining({
          contactName: 'Maria Silva',
          username: 'maria.silva',
          avatarUrl: 'https://cdn.example.com/new-avatar.jpg',
          instagramProfileLookupAttemptedAt: expect.any(String),
          instagramProfileStrategyVersion: 1,
          instagramProfileSyncedAt: expect.any(String),
        }),
      }),
    );
    expect(conversation.title).toBe('Maria Silva');
  });

  it('renews an existing avatar after the refresh interval', async () => {
    const oldAttempt = new Date(Date.now() - 7 * 60 * 60 * 1_000).toISOString();
    const conversation = {
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      source: 'instagram',
      externalThreadId: 'instagram:account-1:scoped-user-1',
      title: 'Maria Silva',
      metadata: {
        externalParticipantId: 'scoped-user-1',
        avatarUrl: 'https://cdn.example.com/expired.jpg',
        instagramProfileLookupAttemptedAt: oldAttempt,
        instagramProfileStrategyVersion: 1,
      },
    } as unknown as InboxConversationEntity;
    const metaGraphService = {
      getInstagramUserProfile: jest.fn().mockResolvedValue({
        id: 'scoped-user-1',
        name: 'Maria Silva',
        username: 'maria.silva',
        profilePictureUrl: 'https://cdn.example.com/fresh.jpg',
      }),
    };
    const conversationsRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new InstagramContactEnrichmentService(
      {
        find: jest.fn().mockResolvedValue([
          {
            id: 'channel-1',
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            accessTokenEncrypted: 'encrypted-token',
            metadata: {},
          },
        ]),
      } as never,
      conversationsRepository as never,
      { decrypt: jest.fn().mockReturnValue('access-token') } as never,
      metaGraphService as never,
    );

    await service.refreshProfiles([conversation]);

    expect(metaGraphService.getInstagramUserProfile).toHaveBeenCalled();
    expect(conversation.metadata.avatarUrl).toBe(
      'https://cdn.example.com/fresh.jpg',
    );
  });

  it('does not call Meta again inside the retry interval', async () => {
    const conversation = {
      source: 'instagram',
      metadata: {
        instagramProfileLookupAttemptedAt: new Date().toISOString(),
        instagramProfileStrategyVersion: 1,
      },
    } as unknown as InboxConversationEntity;
    const channelsRepository = { find: jest.fn() };
    const service = new InstagramContactEnrichmentService(
      channelsRepository as never,
      { update: jest.fn() } as never,
      { decrypt: jest.fn() } as never,
      { getInstagramUserProfile: jest.fn() } as never,
    );

    await service.refreshProfiles([conversation]);

    expect(channelsRepository.find).not.toHaveBeenCalled();
  });
});
