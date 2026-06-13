import { TeamChatMessagesService } from './team-chat-messages.service';
import { TeamChatChannelKind, TeamChatMessageStatus } from '../enums';

function createRepositoryMock() {
  return {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((value) =>
      Promise.resolve({
        id: value.id ?? 'message-a',
        createdAt: value.createdAt ?? new Date('2026-01-01T10:00:00.000Z'),
        ...value,
      }),
    ),
  };
}

const context = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  userId: 'sender-a',
};

describe('TeamChatMessagesService notifications', () => {
  it('publishes direct message received for a direct channel recipient', async () => {
    const messagesRepository = createRepositoryMock();
    const readsRepository = createRepositoryMock();
    const membersRepository = createRepositoryMock();
    const channelsService = {
      assertChannel: jest.fn().mockResolvedValue({
        id: 'channel-a',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        kind: TeamChatChannelKind.DIRECT,
      }),
    };
    const publisher = {
      publishDirectMessageReceived: jest.fn(),
      publishUserMentioned: jest.fn(),
    };
    membersRepository.find.mockResolvedValue([
      { userId: 'sender-a' },
      { userId: 'recipient-a' },
    ]);

    const service = new TeamChatMessagesService(
      messagesRepository as never,
      readsRepository as never,
      membersRepository as never,
      channelsService as never,
      publisher as never,
    );

    await service.create(context, 'channel-a', { body: 'Olá' });

    expect(publisher.publishDirectMessageReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'recipient-a',
        actorUserId: 'sender-a',
        message: expect.objectContaining({
          status: TeamChatMessageStatus.SENT,
        }),
      }),
    );
    expect(publisher.publishUserMentioned).not.toHaveBeenCalled();
  });

  it('prioritizes mention over direct message for the same recipient', async () => {
    const messagesRepository = createRepositoryMock();
    const readsRepository = createRepositoryMock();
    const membersRepository = createRepositoryMock();
    const channelsService = {
      assertChannel: jest.fn().mockResolvedValue({
        id: 'channel-a',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        kind: TeamChatChannelKind.DIRECT,
      }),
    };
    const publisher = {
      publishDirectMessageReceived: jest.fn(),
      publishUserMentioned: jest.fn(),
    };
    membersRepository.find.mockResolvedValue([
      { userId: 'sender-a' },
      { userId: 'recipient-a' },
    ]);

    const service = new TeamChatMessagesService(
      messagesRepository as never,
      readsRepository as never,
      membersRepository as never,
      channelsService as never,
      publisher as never,
    );

    await service.create(context, 'channel-a', {
      body: '@recipient-a veja isto',
      metadata: { mentionedUserIds: ['recipient-a'] },
    });

    expect(publisher.publishUserMentioned).toHaveBeenCalledWith(
      expect.objectContaining({
        mentionedUserIds: ['recipient-a'],
      }),
    );
    expect(publisher.publishDirectMessageReceived).not.toHaveBeenCalled();
  });

  it('does not publish direct message notifications for public channels', async () => {
    const messagesRepository = createRepositoryMock();
    const readsRepository = createRepositoryMock();
    const membersRepository = createRepositoryMock();
    const channelsService = {
      assertChannel: jest.fn().mockResolvedValue({
        id: 'channel-a',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        kind: TeamChatChannelKind.CHANNEL,
      }),
    };
    const publisher = {
      publishDirectMessageReceived: jest.fn(),
      publishUserMentioned: jest.fn(),
    };

    const service = new TeamChatMessagesService(
      messagesRepository as never,
      readsRepository as never,
      membersRepository as never,
      channelsService as never,
      publisher as never,
    );

    await service.create(context, 'channel-a', { body: 'Mensagem aberta' });

    expect(publisher.publishDirectMessageReceived).not.toHaveBeenCalled();
    expect(publisher.publishUserMentioned).not.toHaveBeenCalled();
  });
});
