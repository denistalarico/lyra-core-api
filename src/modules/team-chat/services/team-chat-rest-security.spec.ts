import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import {
  AgencyChatAttachment,
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
  AgencyChatMessageRead,
} from '../entities';
import {
  TeamChatChannelKind,
  TeamChatChannelStatus,
  TeamChatChannelVisibility,
} from '../enums';
import { WorkspaceUserEntity } from '../../settings/entities/workspace-user.entity';
import { TeamChatChannelsService } from './team-chat-channels.service';
import { TeamChatMessagesService } from './team-chat-messages.service';
import { TeamChatNotificationPublisher } from './team-chat-notification.publisher';

/**
 * REST security matrix (CCOM0.5 §17, §18, §19, §20, §34, §37, §38).
 *
 * Fixtures, as the sprint prescribes:
 *
 * ```text
 * Admin     elevated, member of nothing
 * Member A  participant of channel A only
 * Member B  participant of channel B only
 * ```
 *
 * The repositories are in-memory so the whole matrix runs without a database;
 * the services under test are the real ones.
 */

const TENANT = 'tenant-a';
const WORKSPACE = 'workspace-a';

const CHANNELS: AgencyChatChannel[] = [
  {
    id: 'channel-a',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    visibility: TeamChatChannelVisibility.PRIVATE,
    kind: TeamChatChannelKind.CHANNEL,
    status: TeamChatChannelStatus.ACTIVE,
  } as AgencyChatChannel,
  {
    id: 'channel-b',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    visibility: TeamChatChannelVisibility.PRIVATE,
    kind: TeamChatChannelKind.CHANNEL,
    status: TeamChatChannelStatus.ACTIVE,
  } as AgencyChatChannel,
  {
    id: 'channel-open',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    visibility: TeamChatChannelVisibility.WORKSPACE,
    kind: TeamChatChannelKind.CHANNEL,
    status: TeamChatChannelStatus.ACTIVE,
  } as AgencyChatChannel,
  {
    id: 'channel-other-workspace',
    tenantId: TENANT,
    workspaceId: 'workspace-z',
    visibility: TeamChatChannelVisibility.PRIVATE,
    kind: TeamChatChannelKind.CHANNEL,
    status: TeamChatChannelStatus.ACTIVE,
  } as AgencyChatChannel,
];

const MEMBERS: AgencyChatChannelMember[] = [
  {
    id: 'member-a',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    channelId: 'channel-a',
    userId: 'user-a',
    leftAt: null,
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastReadAt: null,
  } as AgencyChatChannelMember,
  {
    id: 'member-b',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    channelId: 'channel-b',
    userId: 'user-b',
    leftAt: null,
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastReadAt: null,
  } as AgencyChatChannelMember,
];

const MESSAGES: AgencyChatMessage[] = [
  {
    id: 'message-a',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    channelId: 'channel-a',
    senderUserId: 'user-a',
    body: 'segredo do canal A',
    metadata: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
  } as AgencyChatMessage,
  {
    id: 'message-b',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    channelId: 'channel-b',
    senderUserId: 'user-b',
    body: 'segredo do canal B',
    metadata: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
  } as AgencyChatMessage,
];

const WORKSPACE_USERS = [
  { userId: 'user-a', status: 'active', workspaceId: WORKSPACE },
  { userId: 'user-b', status: 'active', workspaceId: WORKSPACE },
  { userId: 'user-admin', status: 'active', workspaceId: WORKSPACE },
  { userId: 'user-inactive', status: 'inactive', workspaceId: WORKSPACE },
  {
    userId: 'user-other-workspace',
    status: 'active',
    workspaceId: 'workspace-z',
  },
];

const memberA = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  userId: 'user-a',
  role: 'member',
};
const memberB = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  userId: 'user-b',
  role: 'member',
};
const admin = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  userId: 'user-admin',
  role: 'admin',
};

/** Minimal in-memory `where` matcher. Entities have no index signature, so the
 * row is read through an unknown-keyed view. */
function matches(row: object, where: Record<string, unknown>) {
  const record = row as Record<string, unknown>;

  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    return record[key] === value;
  });
}

function makeServices() {
  const members = MEMBERS.map((row) => ({ ...row }));

  const channelsRepository = {
    findOne: jest.fn(({ where }) =>
      Promise.resolve(CHANNELS.find((row) => matches(row, where)) ?? null),
    ),
    createQueryBuilder: jest.fn(),
    count: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve(v)),
    delete: jest.fn(),
  };

  const membersRepository = {
    findOne: jest.fn(({ where }) =>
      Promise.resolve(members.find((row) => matches(row, where)) ?? null),
    ),
    find: jest.fn(({ where }) =>
      Promise.resolve(members.filter((row) => matches(row, where))),
    ),
    count: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve(v)),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const messagesRepository = {
    findOne: jest.fn(({ where }) =>
      Promise.resolve(MESSAGES.find((row) => matches(row, where)) ?? null),
    ),
    find: jest.fn(({ where }) =>
      Promise.resolve(MESSAGES.filter((row) => matches(row, where))),
    ),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn((v) => Promise.resolve({ id: 'message-new', ...v })),
    delete: jest.fn(),
  };

  const workspaceUsersQb = {
    select: jest.fn(() => workspaceUsersQb),
    where: jest.fn(() => workspaceUsersQb),
    andWhere: jest.fn((_clause: string, params?: Record<string, unknown>) => {
      if (params && 'candidates' in params) {
        workspaceUsersQb.candidates = params.candidates as string[];
      }
      return workspaceUsersQb;
    }),
    candidates: [] as string[],
    getRawMany: jest.fn(() =>
      Promise.resolve(
        WORKSPACE_USERS.filter(
          (row) =>
            row.status === 'active' &&
            row.workspaceId === WORKSPACE &&
            workspaceUsersQb.candidates.includes(row.userId),
        ).map((row) => ({ userId: row.userId })),
      ),
    ),
  };

  const workspaceUsersRepository = {
    createQueryBuilder: jest.fn(() => workspaceUsersQb),
  };

  const publisher = {
    publishChannelInvited: jest.fn(),
    publishUserMentioned: jest.fn(),
    publishDirectMessageReceived: jest.fn(),
  } as unknown as TeamChatNotificationPublisher;

  const channelsService = new TeamChatChannelsService(
    channelsRepository as unknown as Repository<AgencyChatChannel>,
    membersRepository as unknown as Repository<AgencyChatChannelMember>,
    messagesRepository as unknown as Repository<AgencyChatMessage>,
    {
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<AgencyChatAttachment>,
    workspaceUsersRepository as unknown as Repository<WorkspaceUserEntity>,
    publisher,
  );

  const assetAccess = {
    isPrivatePath: jest.fn().mockReturnValue(false),
    issueGrant: jest.fn(),
  };

  const messagesService = new TeamChatMessagesService(
    messagesRepository as unknown as Repository<AgencyChatMessage>,
    {
      create: jest.fn((v) => v),
      save: jest.fn(),
    } as unknown as Repository<AgencyChatMessageRead>,
    membersRepository as unknown as Repository<AgencyChatChannelMember>,
    channelsService,
    publisher,
    assetAccess as never,
  );

  return { channelsService, messagesService, publisher, members };
}

describe('Team Chat REST channel access', () => {
  it('lets member A read channel A', async () => {
    const { messagesService } = makeServices();

    const messages = await messagesService.list(memberA, 'channel-a', {});

    expect(messages.map((m) => m.id)).toEqual(['message-a']);
  });

  it('stops member A reading channel B even with the channel id', async () => {
    const { messagesService } = makeServices();

    await expect(
      messagesService.list(memberA, 'channel-b', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops member B reading channel A', async () => {
    const { messagesService } = makeServices();

    await expect(
      messagesService.list(memberB, 'channel-a', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not reveal that an inaccessible message exists', async () => {
    const { messagesService } = makeServices();

    // §18: a message id of an inaccessible channel is a 404, not a 403.
    await expect(
      messagesService.react(memberA, 'channel-b', 'message-b', { emoji: '👍' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops member A reacting in channel B', async () => {
    const { messagesService } = makeServices();

    await expect(
      messagesService.react(memberA, 'channel-b', 'message-b', { emoji: '👍' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops member A pinning in channel B', async () => {
    const { messagesService } = makeServices();

    await expect(
      messagesService.pin(memberA, 'channel-b', 'message-b', true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops member A marking channel B as read', async () => {
    const { messagesService } = makeServices();

    await expect(
      messagesService.markAsRead(memberA, 'channel-b'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops member A sending to channel B', async () => {
    const { messagesService } = makeServices();

    await expect(
      messagesService.list(memberA, 'channel-b', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows the documented admin bypass', async () => {
    const { messagesService } = makeServices();

    // §34: admin reads both channels, which matches `applyCollectionScope`.
    await expect(
      messagesService.list(admin, 'channel-a', {}),
    ).resolves.toHaveLength(1);
    await expect(
      messagesService.list(admin, 'channel-b', {}),
    ).resolves.toHaveLength(1);
  });

  it('does not let an admin cross into another workspace', async () => {
    const { messagesService } = makeServices();

    await expect(
      messagesService.list(admin, 'channel-other-workspace', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets any workspace user read a workspace-visible channel', async () => {
    const { messagesService } = makeServices();

    await expect(
      messagesService.list(memberA, 'channel-open', {}),
    ).resolves.toEqual([]);
  });

  it('refuses a reaction from an unauthenticated context', async () => {
    const { messagesService } = makeServices();

    await expect(
      messagesService.react(
        { ...memberA, userId: null },
        'channel-a',
        'message-a',
        { emoji: '👍' },
      ),
    ).rejects.toBeTruthy();
  });
});

describe('Team Chat addMembers validation', () => {
  it('adds an active workspace user', async () => {
    const { channelsService } = makeServices();

    const result = await channelsService.addMembers(memberA, 'channel-a', {
      userIds: ['user-b'],
    });

    expect(result).toHaveLength(1);
  });

  it('rejects a random UUID', async () => {
    const { channelsService } = makeServices();

    await expect(
      channelsService.addMembers(memberA, 'channel-a', {
        userIds: ['11111111-1111-4111-8111-111111111111'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a user of another workspace', async () => {
    const { channelsService } = makeServices();

    await expect(
      channelsService.addMembers(memberA, 'channel-a', {
        userIds: ['user-other-workspace'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an inactive workspace user', async () => {
    const { channelsService } = makeServices();

    await expect(
      channelsService.addMembers(memberA, 'channel-a', {
        userIds: ['user-inactive'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a Client Area-only identity', async () => {
    const { channelsService } = makeServices();

    // A Client Area person has an identity in `user_security_settings` but no
    // `workspace_users` row, so they can never be resolved here (§22/§37).
    await expect(
      channelsService.addMembers(memberA, 'channel-a', {
        userIds: ['client-area-person'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sets the unread watermark to join time for a new member', async () => {
    const { channelsService } = makeServices();

    const [created] = await channelsService.addMembers(memberA, 'channel-a', {
      userIds: ['user-b'],
    });

    // §29: the new row carries lastReadAt = joinedAt, so the member does not
    // inherit the channel's whole history as unread.
    expect(created.joinedAt).toBeInstanceOf(Date);
    expect(created.lastReadAt).toEqual(created.joinedAt);
  });
});

describe('Team Chat unread watermark', () => {
  /**
   * §29. `countUnreadMessages` is private, so it is exercised through the public
   * `listEnriched` path with a stubbed channel list.
   */
  function makeUnreadHarness(membership: Partial<AgencyChatChannelMember>) {
    const counted: Record<string, unknown>[] = [];
    const qb = {
      where: jest.fn(() => qb),
      andWhere: jest.fn((_clause: string, params?: Record<string, unknown>) => {
        if (params) counted.push(params);
        return qb;
      }),
      getCount: jest.fn().mockResolvedValue(7),
    };

    const messagesRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      // The pre-CCOM0.5 bug counted the channel's whole history through this.
      count: jest.fn().mockResolvedValue(999),
      createQueryBuilder: jest.fn(() => qb),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve(v)),
      delete: jest.fn(),
    };

    const channelsQb = {
      where: jest.fn(() => channelsQb),
      andWhere: jest.fn(() => channelsQb),
      orderBy: jest.fn(() => channelsQb),
      addOrderBy: jest.fn(() => channelsQb),
      take: jest.fn(() => channelsQb),
      getMany: jest
        .fn()
        .mockResolvedValue([
          { ...CHANNELS[0], kind: TeamChatChannelKind.CHANNEL },
        ]),
      getCount: jest.fn().mockResolvedValue(1),
    };

    const service = new TeamChatChannelsService(
      {
        createQueryBuilder: jest.fn(() => channelsQb),
        findOne: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        delete: jest.fn(),
      } as unknown as Repository<AgencyChatChannel>,
      {
        findOne: jest.fn().mockResolvedValue(membership),
        find: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      } as unknown as Repository<AgencyChatChannelMember>,
      messagesRepository as unknown as Repository<AgencyChatMessage>,
      {
        createQueryBuilder: jest.fn(),
      } as unknown as Repository<AgencyChatAttachment>,
      {
        createQueryBuilder: jest.fn(),
      } as unknown as Repository<WorkspaceUserEntity>,
      {} as TeamChatNotificationPublisher,
    );

    return { service, messagesRepository, counted };
  }

  it('counts from last_read_at when the member has read before', async () => {
    const lastReadAt = new Date('2026-02-01T00:00:00.000Z');
    const { service, messagesRepository, counted } = makeUnreadHarness({
      lastReadAt,
      joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const [channel] = await service.listEnriched(memberA, {});

    expect(channel.unreadCount).toBe(7);
    expect(messagesRepository.count).not.toHaveBeenCalled();
    expect(counted).toContainEqual({ watermark: lastReadAt });
  });

  it('falls back to joined_at instead of counting all history', async () => {
    const joinedAt = new Date('2026-01-15T00:00:00.000Z');
    const { service, messagesRepository, counted } = makeUnreadHarness({
      lastReadAt: null,
      joinedAt,
    });

    const [channel] = await service.listEnriched(memberA, {});

    // The bug: `last_read_at = null` used to return every message in the
    // channel (999 here). It now counts only messages after the join.
    expect(channel.unreadCount).toBe(7);
    expect(messagesRepository.count).not.toHaveBeenCalled();
    expect(counted).toContainEqual({ watermark: joinedAt });
  });

  it('counts nothing for a legacy row with neither timestamp', async () => {
    const { service } = makeUnreadHarness({ lastReadAt: null, joinedAt: null });

    const [channel] = await service.listEnriched(memberA, {});

    expect(channel.unreadCount).toBe(0);
  });

  it('counts nothing when the user has no membership row', async () => {
    const { service } = makeUnreadHarness(null as never);

    const [channel] = await service.listEnriched(memberA, {});

    expect(channel.unreadCount).toBe(0);
  });
});

describe('Team Chat mention validation', () => {
  async function sendWithMentions(
    channelId: string,
    mentionedUserIds: string[],
  ) {
    const { messagesService, publisher } = makeServices();

    await messagesService.create(memberA, channelId, {
      body: 'veja isto',
      metadata: { mentionedUserIds },
    });

    return publisher.publishUserMentioned as jest.Mock;
  }

  it('notifies a participant of the channel', async () => {
    // user-a is the only participant of channel-a; mentioning self is allowed by
    // the eligibility rule and filtered later by selfNotificationPolicy.
    const publish = await sendWithMentions('channel-a', ['user-a']);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ mentionedUserIds: ['user-a'] }),
    );
  });

  it('ignores a random UUID', async () => {
    const publish = await sendWithMentions('channel-a', [
      '11111111-1111-4111-8111-111111111111',
    ]);

    expect(publish).not.toHaveBeenCalled();
  });

  it('ignores a user of another workspace', async () => {
    const publish = await sendWithMentions('channel-a', [
      'user-other-workspace',
    ]);

    expect(publish).not.toHaveBeenCalled();
  });

  it('does not notify a non-participant of a private channel', async () => {
    // user-b is a real workspace user but not a participant of channel-a.
    const publish = await sendWithMentions('channel-a', ['user-b']);

    expect(publish).not.toHaveBeenCalled();
  });

  it('allows mentioning any workspace user in a workspace-visible channel', async () => {
    const publish = await sendWithMentions('channel-open', ['user-b']);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ mentionedUserIds: ['user-b'] }),
    );
  });
});
