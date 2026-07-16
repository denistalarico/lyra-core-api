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
});
