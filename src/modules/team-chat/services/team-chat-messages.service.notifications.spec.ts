import { TeamChatMessagesService } from './team-chat-messages.service';
import {
  TeamChatChannelKind,
  TeamChatChannelStatus,
  TeamChatChannelVisibility,
  TeamChatMessageStatus,
} from '../enums';

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

/**
 * CCOM0.5 renamed the gate to `assertChannelAccess` and made mentions resolve
 * through the channels service, so the stub provides both. `eligibleMentions`
 * is the set of ids the workspace/participation filters would accept.
 */
function createChannelsServiceMock(
  channel: Record<string, unknown>,
  eligibleMentions: string[] = [],
) {
  return {
    assertChannelAccess: jest.fn().mockResolvedValue(channel),
    resolveActiveWorkspaceUserIds: jest
      .fn()
      .mockResolvedValue(new Set(eligibleMentions)),
    getActiveParticipantUserIds: jest
      .fn()
      .mockResolvedValue(new Set(eligibleMentions)),
  };
}

const assetAccess = {
  isPrivatePath: jest.fn().mockReturnValue(false),
  issueGrant: jest.fn(),
};

const orionMentions = {
  schedule: jest.fn(),
};

describe('TeamChatMessagesService notifications', () => {
  it('publishes direct message received for a direct channel recipient', async () => {
    const messagesRepository = createRepositoryMock();
    const readsRepository = createRepositoryMock();
    const membersRepository = createRepositoryMock();
    const channelsService = createChannelsServiceMock({
      id: 'channel-a',
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      kind: TeamChatChannelKind.DIRECT,
      visibility: TeamChatChannelVisibility.PRIVATE,
      status: TeamChatChannelStatus.ACTIVE,
    });
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
      assetAccess as never,
      orionMentions as never,
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
    const channelsService = createChannelsServiceMock(
      {
        id: 'channel-a',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        kind: TeamChatChannelKind.DIRECT,
        visibility: TeamChatChannelVisibility.PRIVATE,
        status: TeamChatChannelStatus.ACTIVE,
      },
      ['recipient-a'],
    );
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
      assetAccess as never,
      orionMentions as never,
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
    const channelsService = createChannelsServiceMock({
      id: 'channel-a',
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      kind: TeamChatChannelKind.CHANNEL,
      visibility: TeamChatChannelVisibility.WORKSPACE,
      status: TeamChatChannelStatus.ACTIVE,
    });
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
      assetAccess as never,
      orionMentions as never,
    );

    await service.create(context, 'channel-a', { body: 'Mensagem aberta' });

    expect(publisher.publishDirectMessageReceived).not.toHaveBeenCalled();
    expect(publisher.publishUserMentioned).not.toHaveBeenCalled();
  });

  it('schedules Orion once on create and never retriggers it from an edit', async () => {
    orionMentions.schedule.mockClear();
    const messagesRepository = createRepositoryMock();
    const readsRepository = createRepositoryMock();
    const membersRepository = createRepositoryMock();
    const channel = {
      id: 'channel-a',
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      kind: TeamChatChannelKind.CHANNEL,
      visibility: TeamChatChannelVisibility.WORKSPACE,
      status: TeamChatChannelStatus.ACTIVE,
    };
    const channelsService = createChannelsServiceMock(channel);
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
      assetAccess as never,
      orionMentions as never,
    );

    const created = await service.create(context, 'channel-a', {
      body: '@Orion, veja o CRM',
      metadata: { assistantMention: 'orion' },
    });
    messagesRepository.findOne.mockResolvedValue(created);
    await service.patch(context, 'channel-a', created.id, {
      body: '@Orion, veja apenas o funil',
      metadata: { assistantMention: 'orion' },
    });

    expect(orionMentions.schedule).toHaveBeenCalledTimes(1);
    expect(orionMentions.schedule).toHaveBeenCalledWith({
      context,
      channelId: 'channel-a',
      message: expect.objectContaining({
        id: 'message-a',
        metadata: { assistantMention: 'orion' },
      }),
    });
  });
});
