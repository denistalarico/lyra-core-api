import { AgencySalesEventsReadService } from './agency-sales-events-read.service';

const scope = {
  tenantId: '00000000-0000-4000-8000-0000000000a1',
  workspaceId: '00000000-0000-4000-8000-0000000000b1',
};
const snapshot = (stageId: string) => ({
  pipelineId: 'p1',
  stageId,
  status: 'open',
  amountCents: 0,
  currency: 'BRL',
  ownerUserId: null,
});
const row = (
  id: string,
  eventType: string,
  before: string | null,
  after: string,
) => ({
  id,
  opportunityId: 'o1',
  eventType,
  beforeData: before ? snapshot(before) : null,
  afterData: snapshot(after),
  actorType: 'user',
  actorUserId: 'u1',
  occurredAt: new Date(`2026-11-20T10:00:0${id}.000Z`),
});

function setup(rows: unknown[]) {
  const calls: Array<[string, unknown?]> = [];
  type Chain = Record<
    'where' | 'andWhere' | 'orderBy' | 'addOrderBy' | 'limit' | 'getMany',
    jest.Mock
  >;
  const qb = {} as Chain;
  const record = (sql: string, params?: unknown): Chain => {
    calls.push([sql, params]);
    return qb;
  };
  const self = (): Chain => qb;
  Object.assign(qb, {
    where: jest.fn(record),
    andWhere: jest.fn(record),
    orderBy: jest.fn(self),
    addOrderBy: jest.fn(self),
    limit: jest.fn(self),
    getMany: jest.fn(() => Promise.resolve(rows)),
  });
  const repo = {
    createQueryBuilder: jest.fn(() => qb),
    find: jest.fn(() => Promise.resolve(rows)),
  };
  return {
    service: new AgencySalesEventsReadService(repo as never),
    qb,
    repo,
    calls,
  };
}

describe('AgencySalesEventsReadService (AG-EVT)', () => {
  it('pages the scope by (occurred_at, id), labelled agency_sales', async () => {
    const { service, qb, calls } = setup([row('1', 'stage_changed', 'a', 'b')]);
    const cursor = { occurredAt: new Date('2026-11-20T09:00:00Z'), id: 'x' };
    const page = await service.listSince(scope, cursor, 50);
    expect(calls[0][1]).toEqual(scope);
    expect(calls).toContainEqual([
      '("e"."occurred_at", "e"."id") > (:cursorAt, :cursorId)',
      { cursorAt: cursor.occurredAt, cursorId: 'x' },
    ]);
    expect(qb.limit).toHaveBeenCalledWith(50);
    expect(page.events[0]).toMatchObject({
      crm: 'agency_sales',
      eventType: 'stage_changed',
    });
    expect(page.nextCursor).toEqual({
      occurredAt: page.events[0].occurredAt,
      id: '1',
    });
  });

  it('clamps the page and keeps the cursor on an empty page', async () => {
    const { service, qb } = setup([]);
    const cursor = { occurredAt: new Date('2026-11-20T09:00:00Z'), id: 'x' };
    expect((await service.listSince(scope, cursor, 10_000)).nextCursor).toBe(
      cursor,
    );
    expect(qb.limit).toHaveBeenCalledWith(500);
  });

  it('leaves the newest seconds for the next page', async () => {
    const { service, calls } = setup([]);
    await service.listSince(scope, null);
    expect(calls.map(([sql]) => sql)).toContainEqual(
      `"e"."occurred_at" <= now() - interval '5 seconds'`,
    );
  });

  it('builds the stage history from creation and stage changes', async () => {
    const { service, repo } = setup([
      row('1', 'opportunity_created', null, 'new'),
      row('2', 'stage_changed', 'new', 'qualified'),
    ]);
    const history = await service.stageHistory(scope, 'o1');
    expect(history.map((entry) => [entry.fromStageId, entry.stageId])).toEqual([
      [null, 'new'],
      ['new', 'qualified'],
    ]);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          expect.objectContaining({ ...scope, opportunityId: 'o1' }),
          expect.objectContaining({ ...scope, opportunityId: 'o1' }),
        ],
      }),
    );
  });
});
