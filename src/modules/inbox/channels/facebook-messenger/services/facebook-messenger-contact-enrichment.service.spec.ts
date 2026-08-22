import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { FacebookMessengerContactEnrichmentService } from './facebook-messenger-contact-enrichment.service';

describe('FacebookMessengerContactEnrichmentService', () => {
  it('backfills name and avatar for an existing Messenger conversation', async () => {
    const channel = {
      id: 'channel-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      accessTokenEncrypted: 'encrypted-page-token',
    } as InboxChannelEntity;
    const conversation = {
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      source: 'facebook_messenger',
      externalThreadId: 'facebook_messenger:page-1:psid-1',
      title: 'Lead do Messenger',
      metadata: {
        externalParticipantId: 'psid-1',
        // A recent attempt from strategy v1 must not delay the new
        // Conversations fallback after deployment.
        messengerProfileLookupAttemptedAt: new Date().toISOString(),
      },
    } as unknown as InboxConversationEntity;
    const channelsRepository = {
      find: jest.fn().mockResolvedValue([channel]),
    };
    const conversationsRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const metaGraphService = {
      getFacebookMessengerUserProfile: jest.fn().mockResolvedValue({
        id: 'psid-1',
        name: 'Maria Silva',
        profilePictureUrl: 'https://cdn.example.com/maria.jpg',
      }),
    };
    const service = new FacebookMessengerContactEnrichmentService(
      channelsRepository as never,
      conversationsRepository as never,
      { decrypt: jest.fn().mockReturnValue('page-access-token') } as never,
      metaGraphService as never,
    );

    await service.enrichMissingProfiles([conversation]);

    expect(
      metaGraphService.getFacebookMessengerUserProfile,
    ).toHaveBeenCalledWith({
      pageScopedUserId: 'psid-1',
      pageAccessToken: 'page-access-token',
      pageId: 'page-1',
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
          avatarUrl: 'https://cdn.example.com/maria.jpg',
          messengerProfileLookupAttemptedAt: expect.any(String),
          messengerProfileStrategyVersion: 2,
          messengerProfileSyncedAt: expect.any(String),
        }),
      }),
    );
    expect(conversation.title).toBe('Maria Silva');
    expect(conversation.metadata.avatarUrl).toBe(
      'https://cdn.example.com/maria.jpg',
    );
  });

  it('does not repeat a failed lookup on every Inbox poll', async () => {
    const conversation = {
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      channelId: 'channel-1',
      source: 'facebook_messenger',
      externalThreadId: 'facebook_messenger:page-1:psid-1',
      title: 'Lead do Messenger',
      metadata: {
        messengerProfileLookupAttemptedAt: new Date().toISOString(),
        messengerProfileStrategyVersion: 2,
      },
    } as unknown as InboxConversationEntity;
    const channelsRepository = { find: jest.fn() };
    const service = new FacebookMessengerContactEnrichmentService(
      channelsRepository as never,
      { update: jest.fn() } as never,
      { decrypt: jest.fn() } as never,
      { getFacebookMessengerUserProfile: jest.fn() } as never,
    );

    await service.enrichMissingProfiles([conversation]);

    expect(channelsRepository.find).not.toHaveBeenCalled();
  });
});
