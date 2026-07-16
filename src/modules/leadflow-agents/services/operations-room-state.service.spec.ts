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
      service.listRoomEventsAfter('tenant-a', 'workspace-a', '3', 100),
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
        service.listRoomEventsAfter('tenant-a', 'workspace-a', cursor, 100),
      ).rejects.toThrow('Cursor de roomVersion inválido.');
    },
  );
});
