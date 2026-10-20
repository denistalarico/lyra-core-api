import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { ClientAreaInboxGateway } from './client-area-inbox.gateway';
import type { ClientAreaSessionService } from '../client-area/services/client-area-session.service';
import type { ClientAreaAuthorizationService } from '../client-area/services/client-area-authorization.service';
import type {
  InboxRealtimeEvent,
  InboxRealtimeEventBusService,
} from '../inbox/realtime/inbox-realtime-event-bus.service';

describe('CA11 isolated Client Area Inbox realtime', () => {
  const secret = 'ca11-client-secret-01234567890123456789',
    agencySecret = 'ca11-agency-secret-01234567890123456789';
  const tenantId = randomUUID(),
    workspaceId = randomUUID(),
    agencyClientId = randomUUID(),
    companyContextId = randomUUID(),
    userId = randomUUID();
  const jwt = new JwtService();
  let gateway: ClientAreaInboxGateway;
  const authenticate = jest.fn(),
    authorize = jest.fn();
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
  beforeEach(() => {
    authenticate.mockResolvedValue({
      tenantId,
      userId,
      sessionId: randomUUID(),
    });
    authorize.mockImplementation(({ companyContextId: id }) => {
      if (id !== companyContextId) throw new Error('404');
      return {
        tenantId,
        workspaceId,
        agencyClientId,
        companyContextId,
        memberAccess: { leadflow_inbox: { available: true, level: 'viewer' } },
      };
    });
    gateway = new ClientAreaInboxGateway(
      jwt,
      new ConfigService({
        JWT_CLIENT_AREA_ACCESS_SECRET: secret,
        JWT_ACCESS_SECRET: agencySecret,
        CLIENT_AREA_BRIDGE_ENABLED: 'true',
      }),
      { authenticate } as unknown as ClientAreaSessionService,
      { authorize } as unknown as ClientAreaAuthorizationService,
      {
        onEvent: jest.fn(() => jest.fn()),
        onResync: jest.fn(() => jest.fn()),
      } as unknown as InboxRealtimeEventBusService,
    );
  });
  it('rejects Agency tokens and foreign rooms; ignores caller-supplied tenant/user/room', async () => {
    const agency = socket(
      jwt.sign({ sub: userId, tenantId }, { secret: agencySecret }),
    );
    expect(await gateway.join(agency.client, { companyContextId })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    const own = socket();
    expect(
      await gateway.join(own.client, { companyContextId: randomUUID() }),
    ).toEqual({ ok: false, error: 'unavailable' });
    expect(
      await gateway.join(own.client, {
        companyContextId,
        room: 'agency',
        tenantId: randomUUID(),
      }),
    ).toEqual({ ok: true, companyContextId });
    expect(own.join).toHaveBeenCalledWith(`client:${companyContextId}:inbox`);
  });
  it('revalidates before every delivery and never delivers a sibling company or internal scope fields', async () => {
    const own = socket();
    await gateway.join(own.client, { companyContextId });
    const event: InboxRealtimeEvent = {
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
      scopeKind: 'company',
      eventId: randomUUID(),
      idempotencyKey: 'event',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      eventName: 'leadflow.inbox.message.created',
      aggregateId: randomUUID(),
      projection: { messageId: randomUUID(), token: 'secret' },
    };
    await gateway.deliver({ ...event, companyContextId: randomUUID() });
    expect(own.emit).not.toHaveBeenCalled();
    await gateway.deliver(event);
    expect(own.emit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(own.emit.mock.calls)).not.toMatch(
      /secret|tenantId|workspaceId|agencyClientId/,
    );
    authorize.mockRejectedValue(new Error('revoked'));
    await gateway.deliver(event);
    expect(own.emit).toHaveBeenCalledTimes(1);
    expect(own.leave).toHaveBeenCalledWith(`client:${companyContextId}:inbox`);
  });
  it('unsubscribes the bus on shutdown without disconnecting CCOM sockets', () => {
    const off = jest.fn();
    const bus = (
      gateway as unknown as { bus: { onEvent: jest.Mock; onResync: jest.Mock } }
    ).bus;
    bus.onEvent.mockReturnValue(off);
    bus.onResync.mockReturnValue(off);
    gateway.onModuleInit();
    gateway.onModuleDestroy();
    expect(off).toHaveBeenCalledTimes(2);
  });
});
