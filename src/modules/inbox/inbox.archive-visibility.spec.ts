import type { RequestContext } from '../../common/context/request-context.interface';
import { InboxService } from './inbox.service';

type WhereCall = { clause: string; params?: Record<string, unknown> };
type QueryBuilderDouble = {
  where: (
    clause: string,
    params?: Record<string, unknown>,
  ) => QueryBuilderDouble;
  andWhere: (
    clause: string,
    params?: Record<string, unknown>,
  ) => QueryBuilderDouble;
  orderBy: () => QueryBuilderDouble;
  addOrderBy: () => QueryBuilderDouble;
  take: () => QueryBuilderDouble;
  getManyAndCount: jest.Mock;
};

function createService() {
  const whereCalls: WhereCall[] = [];
  const queryBuilder: QueryBuilderDouble = {
    where(clause: string, params?: Record<string, unknown>) {
      whereCalls.push({ clause, params });
      return queryBuilder;
    },
    andWhere(clause: string, params?: Record<string, unknown>) {
      whereCalls.push({ clause, params });
      return queryBuilder;
    },
    orderBy() {
      return queryBuilder;
    },
    addOrderBy() {
      return queryBuilder;
    },
    take() {
      return queryBuilder;
    },
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  };
  const service = Object.create(InboxService.prototype) as InboxService;
  Object.assign(service as unknown as Record<string, unknown>, {
    conversationsRepository: {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    },
  });

  return { service, whereCalls };
}

const context: RequestContext = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
};

describe('InboxService archived conversation visibility', () => {
  it('excludes archived conversations when no status is requested', async () => {
    const { service, whereCalls } = createService();

    await service.listConversations(context, {});

    expect(whereCalls).toContainEqual({
      clause: 'conversation.status != :archivedStatus',
      params: { archivedStatus: 'archived' },
    });
  });

  it('returns archived conversations when that status is requested explicitly', async () => {
    const { service, whereCalls } = createService();

    await service.listConversations(context, { status: 'archived' });

    expect(whereCalls).toContainEqual({
      clause: 'conversation.status = :status',
      params: { status: 'archived' },
    });
    expect(
      whereCalls.some(({ clause }) => clause.includes('archivedStatus')),
    ).toBe(false);
  });
});
