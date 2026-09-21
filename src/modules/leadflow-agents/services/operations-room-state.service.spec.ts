import {
  roomStatusSourceAllowed,
  sanitizeReasonCode,
} from './operations-room-state.service';
import {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../enums/room-operational.enums';
import { OperationsRoomStateService } from './operations-room-state.service';

describe('OperationsRoomStateService contract rules', () => {
  it('allows only the documented producer/status pairs', () => {
    expect(
      roomStatusSourceAllowed(
        RoomAgentOperationalStatus.HandlingConversation,
        RoomOperationalSource.AgentRuntime,
      ),
    ).toBe(true);
    expect(
      roomStatusSourceAllowed(
        RoomAgentOperationalStatus.HandlingConversation,
        RoomOperationalSource.Inbox,
      ),
    ).toBe(false);
    expect(
      roomStatusSourceAllowed(
        RoomAgentOperationalStatus.HandoffRequested,
        RoomOperationalSource.Handoff,
      ),
    ).toBe(true);
  });

  it('keeps only sanitized reason codes', () => {
    expect(sanitizeReasonCode('runtime_timeout')).toBe('runtime_timeout');
    expect(sanitizeReasonCode('raw customer message')).toBeNull();
    expect(sanitizeReasonCode('token=secret')).toBeNull();
  });

  it('returns unknown only for the authorized ids supplied by the caller', async () => {
    const service = new OperationsRoomStateService(
      {
        getRepository: () => ({ findOneBy: () => Promise.resolve(null) }),
      } as never,
      { findBy: () => Promise.resolve([]) } as never,
      { find: () => Promise.resolve([]) } as never,
    );
    const snapshot = await service.getSnapshot('tenant-a', 'workspace-a', [
      'agent-b',
      'agent-a',
    ]);
    expect(snapshot.agents.map((agent) => agent.agentId)).toEqual([
      'agent-a',
      'agent-b',
    ]);
    expect(
      snapshot.agents.every(
        (agent) => agent.status === RoomAgentOperationalStatus.Unknown,
      ),
    ).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/prompt|message|token/i);
  });

  it('requires snapshot when a replay cursor predates the retained window', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ current_version: '12', earliest_version: '9' }]);
    const service = new OperationsRoomStateService(
      { query } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.listRoomEventsAfter(
        'tenant-a',
        'workspace-a',
        '3',
        ['agent-a'],
        { scopeKind: 'agency', agencyClientId: null, companyContextId: null },
        100,
      ),
    ).resolves.toEqual({
      kind: 'snapshot_required',
      events: [],
      nextRoomVersion: null,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('tenant_id = $1 AND workspace_id = $2'),
      ['tenant-a', 'workspace-a'],
    );
  });

  it.each(['-1', '01', '1.2', '18446744073709551616', 'tenant-a'])(
    'rejects an invalid or unsafe replay cursor (%s)',
    async (cursor) => {
      const service = new OperationsRoomStateService(
        { query: jest.fn() } as never,
        {} as never,
        {} as never,
      );
      await expect(
        service.listRoomEventsAfter(
          'tenant-a',
          'workspace-a',
          cursor,
          ['agent-a'],
          { scopeKind: 'agency', agencyClientId: null, companyContextId: null },
          100,
        ),
      ).rejects.toThrow('Cursor de roomVersion inválido.');
    },
  );

  it('returns no events for a legacy client with no visible agents, instead of the whole workspace replay', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ current_version: '5', earliest_version: '1' }]);
    const service = new OperationsRoomStateService(
      { query } as never,
      {} as never,
      {} as never,
    );

    const page = await service.listRoomEventsAfter(
      'tenant-a',
      'workspace-a',
      '0',
      [],
      { scopeKind: 'agency', agencyClientId: null, companyContextId: null },
      100,
    );

    expect(page).toEqual({ kind: 'events', events: [], nextRoomVersion: null });
  });

  it('scopes replay to the visible-agent set (Company A never receives Company B events)', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ current_version: '5', earliest_version: '1' }]);
    const whereMocks = {
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      take: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    whereMocks.andWhere.mockReturnValue(whereMocks);
    whereMocks.orderBy.mockReturnValue(whereMocks);
    whereMocks.take.mockReturnValue(whereMocks);
    const outboxRepository = {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue(whereMocks),
      }),
    };
    const service = new OperationsRoomStateService(
      { query } as never,
      {} as never,
      outboxRepository as never,
    );

    await service.listRoomEventsAfter(
      'tenant-a',
      'workspace-a',
      '0',
      ['agent-a'],
      {
        scopeKind: 'company',
        agencyClientId: 'client-x',
        companyContextId: 'company-a',
      },
      100,
    );

    expect(whereMocks.andWhere).toHaveBeenCalledWith(
      'event.agent_id IN (:...visibleAgentIds)',
      { visibleAgentIds: ['agent-a'] },
    );
  });
});
