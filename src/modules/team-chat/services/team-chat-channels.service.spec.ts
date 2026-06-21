import { Repository } from 'typeorm';
import {
  AgencyChatAttachment,
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
} from '../entities';
import { TeamChatNotificationPublisher } from './team-chat-notification.publisher';
import { TeamChatChannelsService } from './team-chat-channels.service';

describe('TeamChatChannelsService collection scoping', () => {
  it('lists only channels where a member user has active membership', async () => {
    const { service, queryBuilder } = makeService();

    await service.list(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: 'member',
      },
      {},
    );

    expect(queryBuilder.clauses.join('\n')).toContain(
      'agency_chat_channel_members',
    );
    expect(queryBuilder.clauses.join('\n')).toContain(
      'member_scope.left_at IS NULL',
    );
  });

  it('does not add membership scope for owner channel lists', async () => {
    const { service, queryBuilder } = makeService();

    await service.list(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'owner-1',
        role: 'owner',
      },
      {},
    );

    expect(queryBuilder.clauses.join('\n')).not.toContain(
      'agency_chat_channel_members',
    );
  });
});

function makeService() {
  const queryBuilder = createQueryBuilderMock<AgencyChatChannel>();
  const channelsRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    count: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const membersRepository = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
  const messagesRepository = {
    findOne: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
  };
  const attachmentsRepository = {
    createQueryBuilder: jest.fn(),
  };
  const publisher = {
    publishChannelInvited: jest.fn(),
  } as unknown as TeamChatNotificationPublisher;

  const service = new TeamChatChannelsService(
    channelsRepository as unknown as Repository<AgencyChatChannel>,
    membersRepository as unknown as Repository<AgencyChatChannelMember>,
    messagesRepository as unknown as Repository<AgencyChatMessage>,
    attachmentsRepository as unknown as Repository<AgencyChatAttachment>,
    publisher,
  );

  return { service, queryBuilder };
}

function createQueryBuilderMock<T>() {
  const clauses: string[] = [];
  const qb = {
    clauses,
    where: jest.fn((condition: string) => {
      clauses.push(condition);
      return qb;
    }),
    andWhere: jest.fn((condition: string) => {
      clauses.push(condition);
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getMany: jest.fn().mockResolvedValue([] as T[]),
    getCount: jest.fn().mockResolvedValue(0),
  };

  return qb;
}
