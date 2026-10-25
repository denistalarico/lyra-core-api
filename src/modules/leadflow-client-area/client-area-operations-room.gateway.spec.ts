import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { ClientAreaOperationsRoomGateway } from './client-area-operations-room.gateway';
import type { ClientAreaSessionService } from '../client-area/services/client-area-session.service';
import type { ClientAreaAuthorizationService } from '../client-area/services/client-area-authorization.service';
import type { OperationsRoomEventBusService } from '../leadflow-agents/realtime/operations-room-event-bus.service';
import type { OperationsRoomEventEnvelope } from '../leadflow-agents/types/operations-room.types';
import {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../leadflow-agents/enums/room-operational.enums';

describe('OR3 isolated Client Area Operations Room realtime', () => {
  const secret = 'or3-client-secret-01234567890123456789',
    agencySecret = 'or3-agency-secret-01234567890123456789';
  const tenantId = randomUUID(),
    workspaceId = randomUUID(),
    agencyClientId = randomUUID(),
    companyContextId = randomUUID(),
    userId = randomUUID();
  const jwt = new JwtService();
  const saved = process.env.OPERATIONS_ROOM_REALTIME_ENABLED;
  let gateway: ClientAreaOperationsRoomGateway;
  const authenticate = jest.fn(),
    authorize = jest.fn(),
    isReady = jest.fn();
  let agentsAccess: { available: boolean; level: string | null };
  const socket = (
    token = jwt.sign(
      { sub: userId, tenantId, sessionId: randomUUID(), typ: 'client_area' },
      { secret, expiresIn: 60 },
    ),
  ) => {
    const fixture = {
      handshake: { auth: { token } },
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    };
    return {
      client: fixture as unknown as Socket,
      join: fixture.join,
      leave: fixture.leave,
      emit: fixture.emit,
    };
  };
  const event = (
    overrides: Partial<OperationsRoomEventEnvelope> = {},
  ): OperationsRoomEventEnvelope => ({
    contractVersion: 1,
    eventId: randomUUID(),
    eventType: 'agent.status.changed',
    occurredAt: new Date().toISOString(),
    tenantId,
    workspaceId,
    scopeKind: 'company',
    agencyClientId,
    companyContextId,
    roomVersion: '7',
    agentRevision: '2',
    correlationId: null,
    payload: {
      agentId: randomUUID(),
      status: RoomAgentOperationalStatus.Available,
      statusSince: new Date().toISOString(),
      source: RoomOperationalSource.AgentRuntime,
      reasonCode: null,
    },
    ...overrides,
  });
  afterAll(() => {
    if (saved === undefined)
      delete process.env.OPERATIONS_ROOM_REALTIME_ENABLED;
    else process.env.OPERATIONS_ROOM_REALTIME_ENABLED = saved;
  });
  beforeEach(() => {
    process.env.OPERATIONS_ROOM_REALTIME_ENABLED = 'true';
    isReady.mockReturnValue(true);
    agentsAccess = { available: true, level: 'viewer' };
    authenticate.mockResolvedValue({
      tenantId,
      userId,
      sessionId: randomUUID(),
    });
    authorize.mockImplementation(({ companyContextId: id, module }) => {
      if (id !== companyContextId || module !== 'leadflow_agents')
        throw new Error('404');
      return {
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
        memberAccess: { leadflow_agents: agentsAccess },
      };
    });
    gateway = new ClientAreaOperationsRoomGateway(
      jwt,
      new ConfigService({
        JWT_CLIENT_AREA_ACCESS_SECRET: secret,
        JWT_ACCESS_SECRET: agencySecret,
        CLIENT_AREA_BRIDGE_ENABLED: 'true',
      }),
      { authenticate } as unknown as ClientAreaSessionService,
      { authorize } as unknown as ClientAreaAuthorizationService,
      {
        isReady,
        onEvent: jest.fn(() => jest.fn()),
        onResyncRequired: jest.fn(() => jest.fn()),
      } as unknown as OperationsRoomEventBusService,
    );
  });
  it('rejects Agency tokens, foreign companies and members without Agents; ignores caller-supplied scope', async () => {
    const agency = socket(
      jwt.sign(
        { sub: userId, tenantId, workspaceId, sessionId: randomUUID() },
        { secret: agencySecret },
      ),
    );
    expect(await gateway.join(agency.client, { companyContextId })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    const own = socket();
    expect(
      await gateway.join(own.client, { companyContextId: randomUUID() }),
    ).toEqual({ ok: false, error: 'unavailable' });
    agentsAccess = { available: false, level: null };
    expect(await gateway.join(own.client, { companyContextId })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    agentsAccess = { available: true, level: 'viewer' };
    expect(
      await gateway.join(own.client, {
        companyContextId,
        room: 'agency',
        tenantId: randomUUID(),
      }),
    ).toEqual({ ok: true, companyContextId });
    expect(own.join).toHaveBeenCalledTimes(1);
    expect(own.join).toHaveBeenCalledWith(
      `client:${companyContextId}:operations-room`,
    );
  });
  it('stays closed while the room realtime flag or the shared bus is off', async () => {
    const own = socket();
    process.env.OPERATIONS_ROOM_REALTIME_ENABLED = 'false';
    expect(await gateway.join(own.client, { companyContextId })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    process.env.OPERATIONS_ROOM_REALTIME_ENABLED = 'true';
    isReady.mockReturnValue(false);
    expect(await gateway.join(own.client, { companyContextId })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(own.join).not.toHaveBeenCalled();
  });
  it('revalidates before every delivery and never delivers a sibling company or the agency room', async () => {
    const own = socket();
    await gateway.join(own.client, { companyContextId });
    await gateway.deliver(event({ companyContextId: randomUUID() }));
    await gateway.deliver(event({ agencyClientId: randomUUID() }));
    await gateway.deliver(
      event({
        scopeKind: 'agency',
        agencyClientId: null,
        companyContextId: null,
      }),
    );
    expect(own.emit).not.toHaveBeenCalled();
    const delivered = event();
    await gateway.deliver(delivered);
    // Same envelope `GET room/events` returns to this principal (single source).
    expect(own.emit).toHaveBeenCalledWith('operations-room.event', delivered);
    authorize.mockRejectedValue(new Error('revoked'));
    await gateway.deliver(event());
    expect(own.emit).toHaveBeenCalledTimes(1);
    expect(own.leave).toHaveBeenCalledWith(
      `client:${companyContextId}:operations-room`,
    );
  });
  it('signals resync only to still-authorized subscriptions and unsubscribes on shutdown', async () => {
    const own = socket();
    await gateway.join(own.client, { companyContextId });
    await (gateway as unknown as { resync(): Promise<void> }).resync();
    expect(own.emit).toHaveBeenCalledWith('operations-room.resync-required', {
      companyContextId,
      reason: 'shared_bus_reconnected',
    });
    const off = jest.fn();
    const bus = (
      gateway as unknown as {
        bus: { onEvent: jest.Mock; onResyncRequired: jest.Mock };
      }
    ).bus;
    bus.onEvent.mockReturnValue(off);
    bus.onResyncRequired.mockReturnValue(off);
    gateway.onModuleInit();
    gateway.onModuleDestroy();
    expect(off).toHaveBeenCalledTimes(2);
  });
});
