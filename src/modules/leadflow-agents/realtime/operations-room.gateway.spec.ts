import { operationsRoomKey } from './operations-room-realtime.constants';
import { OperationsRoomGateway } from './operations-room.gateway';

describe('OperationsRoomGateway security boundary', () => {
  const authenticated = {
    sub: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    workspaceId: '33333333-3333-4333-8333-333333333333',
    sessionId: '44444444-4444-4444-8444-444444444444',
    role: 'member',
    exp: Math.floor(Date.now() / 1_000) + 300,
  };

  const companyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const companyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const agencyClientX = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  beforeEach(() => {
    process.env.OPERATIONS_ROOM_REALTIME_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.OPERATIONS_ROOM_REALTIME_ENABLED;
  });

  it('derives the only room from the signed context and ignores forged client context in agency mode', async () => {
    const { gateway, client } = makeGateway({ payload: authenticated });
    client.handshake.auth = {
      token: 'valid',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      roomId: 'operations-room:v1:forged',
    };

    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenCalledWith(
      operationsRoomKey(authenticated.tenantId, authenticated.workspaceId, {
        scopeKind: 'agency',
        agencyClientId: null,
        companyContextId: null,
      }),
    );
    expect(client.join).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
    gateway.handleDisconnect(client as never);
  });

  it('joins the Company A room and never the tenant/workspace-wide room in client mode', async () => {
    const permission = {
      canAccessProduct: jest.fn().mockResolvedValue(true),
      canAccessClientProduct: jest.fn().mockResolvedValue(true),
      can: jest.fn().mockResolvedValue(true),
    };
    const { gateway, client } = makeGateway({
      payload: authenticated,
      permission,
    });
    client.handshake.auth = {
      token: 'valid',
      operatingMode: 'client',
      clientId: agencyClientX,
      companyContextId: companyA,
    };

    await gateway.handleConnection(client as never);

    expect(client.join).toHaveBeenCalledWith(
      operationsRoomKey(authenticated.tenantId, authenticated.workspaceId, {
        scopeKind: 'company',
        agencyClientId: agencyClientX,
        companyContextId: companyA,
      }),
    );
    expect(permission.canAccessClientProduct).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: agencyClientX }),
    );
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('rejects a company id not found for the requested AgencyClient (Company B forged under company A ownership)', async () => {
    const companyContexts = {
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    const { gateway, client } = makeGateway({
      payload: authenticated,
      companyContexts,
    });
    client.handshake.auth = {
      token: 'valid',
      operatingMode: 'client',
      clientId: agencyClientX,
      companyContextId: companyB,
    };

    await gateway.handleConnection(client as never);

    expect(companyContexts.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: companyB,
        agencyClientId: agencyClientX,
        status: 'active',
      }),
    );
    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects an archived company context', async () => {
    const companyContexts = {
      findOneBy: jest
        .fn()
        .mockResolvedValue({ archivedAt: new Date(), status: 'active' }),
    };
    const { gateway, client } = makeGateway({
      payload: authenticated,
      companyContexts,
    });
    client.handshake.auth = {
      token: 'valid',
      operatingMode: 'client',
      clientId: agencyClientX,
      companyContextId: companyA,
    };

    await gateway.handleConnection(client as never);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects client mode without an authorized client-product grant', async () => {
    const permission = {
      canAccessProduct: jest.fn().mockResolvedValue(true),
      canAccessClientProduct: jest.fn().mockResolvedValue(false),
      can: jest.fn().mockResolvedValue(true),
    };
    const { gateway, client } = makeGateway({
      payload: authenticated,
      permission,
    });
    client.handshake.auth = {
      token: 'valid',
      operatingMode: 'client',
      clientId: agencyClientX,
      companyContextId: companyA,
    };

    await gateway.handleConnection(client as never);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects an inconsistent client-mode handshake (clientId without companyContextId)', async () => {
    const { gateway, client } = makeGateway({ payload: authenticated });
    client.handshake.auth = {
      token: 'valid',
      operatingMode: 'client',
      clientId: agencyClientX,
      companyContextId: null,
    };

    await gateway.handleConnection(client as never);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it.each([
    ['missing token', { token: undefined }],
    [
      'invalid token',
      { token: 'invalid', verifyError: new Error('invalid token') },
    ],
    [
      'expired token',
      { token: 'expired', verifyError: new Error('jwt expired') },
    ],
  ])('rejects %s', async (_label, options) => {
    const { gateway, client } = makeGateway(options);
    await gateway.handleConnection(client as never);
    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects revoked sessions, changed workspace, missing entitlement and missing permission', async () => {
    for (const options of [
      { session: null },
      { workspaceUser: null },
      { entitled: false },
      { permitted: false },
    ]) {
      const { gateway, client } = makeGateway({
        payload: authenticated,
        ...options,
      });
      await gateway.handleConnection(client as never);
      expect(client.join).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    }
  });

  it('rejects excessive handshake payload before authorization', async () => {
    const { gateway, client, jwt } = makeGateway({ payload: authenticated });
    client.handshake.auth = { token: 'valid', padding: 'x'.repeat(17 * 1024) };
    await gateway.handleConnection(client as never);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects an old socket after logout/session revocation is observed', async () => {
    jest.useFakeTimers();
    const sessionRepository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(activeSession())
        .mockResolvedValueOnce(null),
    };
    const { gateway, client } = makeGateway({
      payload: { ...authenticated, exp: Math.floor(Date.now() / 1_000) + 3600 },
      sessionRepository,
    });
    await gateway.handleConnection(client as never);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    gateway.handleDisconnect(client as never);
    jest.useRealTimers();
  });
});

function makeGateway(options: Record<string, unknown> = {}) {
  const verifyAsync = options.verifyError
    ? jest.fn().mockRejectedValue(options.verifyError)
    : jest.fn().mockResolvedValue(options.payload);
  const jwt = { verifyAsync };
  const permission = (options.permission as Record<string, jest.Mock>) ?? {
    canAccessProduct: jest.fn().mockResolvedValue(options.entitled ?? true),
    canAccessClientProduct: jest
      .fn()
      .mockResolvedValue(options.entitled ?? true),
    can: jest.fn().mockResolvedValue(options.permitted ?? true),
  };
  const sessions = options.sessionRepository ?? {
    findOne: jest
      .fn()
      .mockResolvedValue(options.session === null ? null : activeSession()),
  };
  const companyContexts = options.companyContexts ?? {
    findOneBy: jest
      .fn()
      .mockResolvedValue({ archivedAt: null, status: 'active' }),
  };
  const gateway = new OperationsRoomGateway(
    jwt as never,
    { get: jest.fn().mockReturnValue('test-secret') } as never,
    permission as never,
    { isReady: jest.fn().mockReturnValue(true) } as never,
    {
      connected: jest.fn(),
      disconnected: jest.fn(),
      rejected: jest.fn(),
    } as never,
    { query: jest.fn().mockResolvedValue([{ room_version: '7' }]) } as never,
    sessions as never,
    {
      findOne: jest
        .fn()
        .mockResolvedValue(
          options.workspaceUser === null ? null : { status: 'active' },
        ),
    } as never,
    companyContexts as never,
  );
  const client: {
    id: string;
    connected: boolean;
    data: Record<string, unknown>;
    handshake: {
      auth: Record<string, unknown>;
      headers: Record<string, string>;
      address: string;
    };
    join: jest.Mock;
    emit: jest.Mock;
    disconnect: jest.Mock;
  } = {
    id: 'socket-1',
    connected: true,
    data: {},
    handshake: {
      auth:
        options.token === undefined && 'token' in options
          ? {}
          : { token: options.token ?? 'valid' },
      headers: {},
      address: '127.0.0.1',
    },
    join: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    disconnect: jest.fn(),
  };
  return { gateway, client, jwt };
}

function activeSession() {
  return {
    revokedAt: null,
    status: 'active',
    expiresAt: new Date(Date.now() + 3_600_000),
  };
}
