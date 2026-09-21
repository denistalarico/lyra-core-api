import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../enums/room-operational.enums';
import { OperationsRoomEventBusService } from './operations-room-event-bus.service';
import { OPERATIONS_ROOM_PG_CHANNEL } from './operations-room-realtime.constants';

describe('OperationsRoomEventBusService fan-out', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const workspaceId = '22222222-2222-4222-8222-222222222222';

  function row(agentId: string) {
    return {
      eventId: '33333333-3333-4333-8333-333333333333',
      contractVersion: 1,
      tenantId,
      workspaceId,
      roomVersion: '9',
      agentId,
      agentRevision: '3',
      eventType: 'agent.status.changed',
      occurredAt: new Date('2026-07-16T12:00:00.000Z'),
      source: RoomOperationalSource.AgentRuntime,
      sourceEventId: 'runtime-9',
      correlationId: null,
      payload: {
        agentId,
        status: RoomAgentOperationalStatus.Available,
        statusSince: '2026-07-16T12:00:00.000Z',
        source: RoomOperationalSource.AgentRuntime,
        reasonCode: null,
      },
    };
  }

  function makeBus(options: {
    outboxRow: ReturnType<typeof row> | null;
    agent: Record<string, unknown> | null;
  }) {
    const outboxRepository = {
      findOneBy: jest.fn().mockResolvedValue(options.outboxRow),
    };
    const agentsRepository = {
      findOne: jest.fn().mockResolvedValue(options.agent),
    };
    const bus = new OperationsRoomEventBusService(
      { query: jest.fn() } as never,
      outboxRepository as never,
      agentsRepository as never,
    );
    return { bus, outboxRepository, agentsRepository };
  }

  function privateBus(bus: OperationsRoomEventBusService) {
    return bus as unknown as {
      handleNotification(notification: {
        channel: string;
        payload: string;
      }): Promise<void>;
    };
  }

  it('Agent A resolves to Company A and the event carries A ownership', async () => {
    const { bus, agentsRepository } = makeBus({
      outboxRow: row('agent-a'),
      agent: {
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-x',
        companyContextId: 'company-a',
      },
    });
    const received: unknown[] = [];
    bus.onEvent((event) => received.push(event));

    await privateBus(bus).handleNotification({
      channel: OPERATIONS_ROOM_PG_CHANNEL,
      payload: row('agent-a').eventId,
    });

    expect(agentsRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'agent-a', tenantId, workspaceId },
      }),
    );
    expect(received).toEqual([
      expect.objectContaining({
        scopeKind: 'company',
        agencyClientId: 'client-x',
        companyContextId: 'company-a',
      }),
    ]);
  });

  it('Agent B resolves to Company B', async () => {
    const { bus } = makeBus({
      outboxRow: row('agent-b'),
      agent: {
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-x',
        companyContextId: 'company-b',
      },
    });
    const received: unknown[] = [];
    bus.onEvent((event) => received.push(event));

    await privateBus(bus).handleNotification({
      channel: OPERATIONS_ROOM_PG_CHANNEL,
      payload: row('agent-b').eventId,
    });

    expect(received).toEqual([
      expect.objectContaining({
        scopeKind: 'company',
        companyContextId: 'company-b',
      }),
    ]);
  });

  it('drops the event when the outbox row references a nonexistent agent', async () => {
    const { bus } = makeBus({ outboxRow: row('missing-agent'), agent: null });
    const received: unknown[] = [];
    bus.onEvent((event) => received.push(event));

    await privateBus(bus).handleNotification({
      channel: OPERATIONS_ROOM_PG_CHANNEL,
      payload: row('missing-agent').eventId,
    });

    expect(received).toEqual([]);
  });

  it('drops the event for a legacy agent missing companyContextId (never falls back to agency room)', async () => {
    const { bus } = makeBus({
      outboxRow: row('agent-legacy'),
      agent: {
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-x',
        companyContextId: null,
      },
    });
    const received: unknown[] = [];
    bus.onEvent((event) => received.push(event));

    await privateBus(bus).handleNotification({
      channel: OPERATIONS_ROOM_PG_CHANNEL,
      payload: row('agent-legacy').eventId,
    });

    expect(received).toEqual([]);
  });

  it('drops the event for a cross-scope agent (agency contextType carrying a client id)', async () => {
    const { bus } = makeBus({
      outboxRow: row('agent-cross'),
      agent: {
        contextType: LeadFlowSettingsContextType.Agency,
        agencyClientId: 'client-x',
        companyContextId: 'company-a',
      },
    });
    const received: unknown[] = [];
    bus.onEvent((event) => received.push(event));

    await privateBus(bus).handleNotification({
      channel: OPERATIONS_ROOM_PG_CHANNEL,
      payload: row('agent-cross').eventId,
    });

    expect(received).toEqual([]);
  });

  it('ignores a payload-forged companyContextId: scope always comes from the persisted Agent', async () => {
    const forgedRow = {
      ...row('agent-a'),
      payload: { ...row('agent-a').payload, companyContextId: 'company-b' },
    };
    const { bus } = makeBus({
      outboxRow: forgedRow,
      agent: {
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-x',
        companyContextId: 'company-a',
      },
    });
    const received: Array<{ companyContextId: string | null }> = [];
    bus.onEvent((event) => received.push(event));

    await privateBus(bus).handleNotification({
      channel: OPERATIONS_ROOM_PG_CHANNEL,
      payload: forgedRow.eventId,
    });

    expect(received[0]?.companyContextId).toBe('company-a');
  });

  it('ignores notifications on other channels', async () => {
    const { bus, outboxRepository } = makeBus({
      outboxRow: row('agent-a'),
      agent: null,
    });
    await privateBus(bus).handleNotification({
      channel: 'unrelated_channel',
      payload: row('agent-a').eventId,
    });
    expect(outboxRepository.findOneBy).not.toHaveBeenCalled();
  });
});
