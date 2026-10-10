import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AgencyClientConversationsGateway } from './agency-client-conversations.gateway';
import { ClientConversationsGateway } from './client-conversations.gateway';
import { conversationRoom } from '../services/client-conversation-access';
import { TenantContextAuthority } from '../../../common/context/tenant-context-authority.service';

const AGENCY_SECRET = 'agency-secret-ccom1-realtime-000000000000';
const CLIENT_SECRET = 'client-area-secret-ccom1-realtime-1111111';

const TENANT = randomUUID();
const WORKSPACE = randomUUID();
const COMPANY = randomUUID();
const OTHER_COMPANY = randomUUID();
const CONVERSATION = randomUUID();
const USER = randomUUID();
const VICTIM = randomUUID();
const SESSION = randomUUID();

/**
 * A socket stub that records what the gateway did to it.
 *
 * `join`/`leave`/`emit` are observed rather than mocked away, because the
 * properties under test are "which room was joined" and "whose identity was
 * emitted" — exactly what the Agency chat got wrong by taking both from the
 * payload.
 */
function socketStub(handshake: Record<string, unknown> = {}) {
  const joined: string[] = [];
  const left: string[] = [];
  const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
  let disconnected = false;

  const socket = {
    id: 'socket-1',
    data: {} as { auth?: unknown },
    handshake: { auth: {}, headers: {}, ...handshake },
    join: (room: string) => {
      joined.push(room);
      return Promise.resolve();
    },
    leave: (room: string) => {
      left.push(room);
      return Promise.resolve();
    },
    to: (room: string) => ({
      emit: (event: string, payload: unknown) =>
        emitted.push({ room, event, payload }),
    }),
    disconnect: (close: boolean) => {
      disconnected = close;
    },
  };

  return {
    socket,
    joined,
    left,
    emitted,
    get disconnected() {
      return disconnected;
    },
  };
}

const jwt = new JwtService({});

const config = (secret: string | undefined, agencySecret: string | undefined) =>
  ({
    get: (key: string) => {
      if (key === 'JWT_CLIENT_AREA_ACCESS_SECRET') return secret;
      if (key === 'JWT_ACCESS_SECRET') return agencySecret;
      return undefined;
    },
  }) as unknown as ConfigService;

const clientToken = (
  payload: Record<string, unknown> = {},
  secret = CLIENT_SECRET,
) =>
  jwt.sign(
    {
      sub: USER,
      tenantId: TENANT,
      sessionId: SESSION,
      typ: 'client_area',
      ...payload,
    },
    { secret, expiresIn: '15m' },
  );

const agencyToken = (
  payload: Record<string, unknown> = {},
  secret = AGENCY_SECRET,
) =>
  jwt.sign(
    {
      sub: USER,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      role: 'member',
      sessionId: SESSION,
      email: 'op@example.com',
      ...payload,
    },
    { secret, expiresIn: '15m' },
  );

/** The Client Area context the authorization service would produce. */
const clientContext = {
  surface: 'client_area' as const,
  userId: USER,
  tenantId: TENANT,
  sessionId: SESSION,
  membershipId: randomUUID(),
  workspaceId: WORKSPACE,
  agencyClientId: randomUUID(),
  companyContextId: COMPANY,
  companyDisplayName: 'Empresa A',
  role: 'client_operator' as const,
  permissions: new Set([
    'client_area.conversations.view',
    'client_area.conversations.send',
  ] as const),
  modules: { approvals: false, conversations: true },
};

/**
 * CCOM1 §52 — the realtime security matrix.
 *
 * Every case here is a property the Agency chat lacked before CCOM0.5: it had
 * no handshake at all, and `tenantId`/`companyContextId`/`userId` arrived in
 * each event's payload. The three claims under test are:
 *
 *   1. no unauthenticated socket stays connected;
 *   2. the room is derived from validated context, never from the payload;
 *   3. the two surfaces reject each other's tokens.
 */
describe('CCOM1 Client Area realtime gateway security', () => {
  function build(options: {
    authorize?: jest.Mock;
    authenticate?: jest.Mock;
    conversations?: Partial<{
      findAccessible: jest.Mock;
      ensureDefaultConversation: jest.Mock;
    }>;
    clientSecret?: string | undefined;
  }) {
    const authenticate =
      options.authenticate ??
      jest.fn(() =>
        Promise.resolve({
          userId: USER,
          tenantId: TENANT,
          sessionId: SESSION,
          email: 'cliente@example.com',
        }),
      );
    const authorize =
      options.authorize ?? jest.fn(() => Promise.resolve(clientContext));
    const conversations = {
      findAccessible: jest.fn(() => Promise.resolve({ id: CONVERSATION })),
      ensureDefaultConversation: jest.fn(() =>
        Promise.resolve({ id: CONVERSATION }),
      ),
      ...options.conversations,
    };

    const gateway = new ClientConversationsGateway(
      jwt,
      config(
        'clientSecret' in options ? options.clientSecret : CLIENT_SECRET,
        AGENCY_SECRET,
      ),
      { authenticate } as never,
      { authorize } as never,
      conversations as never,
    );

    return { gateway, authenticate, authorize, conversations };
  }

  describe('handshake', () => {
    it('accepts a valid Client Area token and derives identity server-side', async () => {
      const { gateway } = build({});
      const stub = socketStub({ auth: { token: clientToken() } });

      await gateway.handleConnection(stub.socket as never);

      expect(stub.disconnected).toBe(false);
      expect(stub.socket.data.auth).toMatchObject({
        userId: USER,
        tenantId: TENANT,
        sessionId: SESSION,
      });
    });

    it.each([
      ['no token', {}],
      ['an Agency access token (no typ)', { auth: { token: agencyToken() } }],
      [
        'a Client Area token signed with the Agency secret',
        { auth: { token: clientToken({}, AGENCY_SECRET) } },
      ],
      [
        'a 2FA challenge token',
        { auth: { token: clientToken({ typ: 'client_area_2fa' }) } },
      ],
      ['garbage', { auth: { token: 'not.a.jwt' } }],
      [
        'an expired token',
        {
          auth: {
            token: jwt.sign(
              {
                sub: USER,
                tenantId: TENANT,
                sessionId: SESSION,
                typ: 'client_area',
              },
              { secret: CLIENT_SECRET, expiresIn: '-1s' },
            ),
          },
        },
      ],
    ])('disconnects a socket presenting %s', async (_label, handshake) => {
      const { gateway } = build({});
      const stub = socketStub(handshake);

      await gateway.handleConnection(stub.socket as never);

      expect(stub.disconnected).toBe(true);
      expect(stub.socket.data.auth).toBeUndefined();
    });

    it('disconnects when a dead session fails the live check', async () => {
      const { gateway } = build({
        authenticate: jest.fn(() => Promise.reject(new Error('session gone'))),
      });
      const stub = socketStub({ auth: { token: clientToken() } });

      await gateway.handleConnection(stub.socket as never);

      expect(stub.disconnected).toBe(true);
    });

    it('refuses every token when the secret is not configured', async () => {
      const { gateway } = build({ clientSecret: undefined });
      const stub = socketStub({ auth: { token: clientToken() } });

      await gateway.handleConnection(stub.socket as never);

      expect(stub.disconnected).toBe(true);
    });
  });

  describe('rooms are derived, never named', () => {
    async function connected(options = {}) {
      const built = build(options);
      const stub = socketStub({ auth: { token: clientToken() } });
      await built.gateway.handleConnection(stub.socket as never);
      return { ...built, stub };
    }

    it('joins the room built from the validated context', async () => {
      const { gateway, stub } = await connected();

      const ack = await gateway.join(stub.socket as never, {
        companyContextId: COMPANY,
      });

      expect(ack).toEqual({ ok: true, conversationId: CONVERSATION });
      expect(stub.joined).toEqual([
        conversationRoom(
          'client_area',
          { tenantId: TENANT, companyContextId: COMPANY },
          CONVERSATION,
        ),
      ]);
    });

    /**
     * The payload carries another tenant, another company, another user and a
     * room name. All of it is ignored: the room comes from the context the
     * authorization service returned.
     */
    it('ignores forged scope and identity in the payload', async () => {
      const { gateway, stub, authorize } = await connected();

      await gateway.join(
        stub.socket as never,
        {
          companyContextId: COMPANY,
          tenantId: 'other-tenant',
          userId: VICTIM,
          room: 'client:*:*:conversation:*',
        } as never,
      );

      expect(stub.joined).toEqual([
        `client:${TENANT}:${COMPANY}:conversation:${CONVERSATION}`,
      ]);
      // The company the *path* asked for is what gets authorized, and the
      // authorization result is what builds the room.
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          companyContextId: COMPANY,
          module: 'conversations',
          permission: 'client_area.conversations.view',
        }),
      );
    });

    it('refuses a company the person has no membership for', async () => {
      const { gateway, stub } = await connected({
        authorize: jest.fn(() => Promise.reject(new Error('no membership'))),
      });

      const ack = await gateway.join(stub.socket as never, {
        companyContextId: OTHER_COMPANY,
      });

      expect(ack).toEqual({ ok: false, error: 'company_not_accessible' });
      expect(stub.joined).toEqual([]);
    });

    it('refuses a conversation id outside the authorized company', async () => {
      const { gateway, stub } = await connected({
        conversations: {
          findAccessible: jest.fn(() => Promise.reject(new Error('404'))),
        },
      });

      const ack = await gateway.join(stub.socket as never, {
        companyContextId: COMPANY,
        conversationId: randomUUID(),
      });

      expect(ack).toEqual({ ok: false, error: 'conversation_not_accessible' });
      expect(stub.joined).toEqual([]);
    });

    it('refuses every event on an unauthenticated socket', async () => {
      const { gateway } = build({});
      const stub = socketStub();

      for (const ack of await Promise.all([
        gateway.join(stub.socket as never, { companyContextId: COMPANY }),
        gateway.leave(stub.socket as never, { companyContextId: COMPANY }),
        gateway.typingStart(stub.socket as never, {
          companyContextId: COMPANY,
        }),
        gateway.typingStop(stub.socket as never, { companyContextId: COMPANY }),
      ])) {
        expect(ack).toEqual({ ok: false, error: 'unauthenticated' });
      }
      expect(stub.joined).toEqual([]);
    });

    it('emits typing with the authenticated identity, not the payload one', async () => {
      const { gateway, stub } = await connected();

      await gateway.typingStart(
        stub.socket as never,
        {
          companyContextId: COMPANY,
          userId: VICTIM,
        } as never,
      );

      expect(stub.emitted).toHaveLength(1);
      expect(stub.emitted[0]).toMatchObject({
        room: `client:${TENANT}:${COMPANY}:conversation:${CONVERSATION}`,
        event: 'client-conversation:typing',
        payload: { userId: USER, surface: 'client_area', typing: true },
      });
    });

    it('leaves the derived room and nothing else', async () => {
      const { gateway, stub } = await connected();

      await gateway.leave(stub.socket as never, { companyContextId: COMPANY });

      expect(stub.left).toEqual([
        `client:${TENANT}:${COMPANY}:conversation:${CONVERSATION}`,
      ]);
    });
  });

  describe('server-side broadcast', () => {
    it('publishes to the client room of that company only', () => {
      const { gateway } = build({});
      const rooms: string[] = [];
      (gateway as unknown as { server: unknown }).server = {
        to: (room: string) => {
          rooms.push(room);
          return { emit: jest.fn() };
        },
      };

      gateway.broadcastMessageCreated({
        tenantId: TENANT,
        companyContextId: COMPANY,
        conversationId: CONVERSATION,
        message: { id: 'm1' },
      });

      expect(rooms).toEqual([
        `client:${TENANT}:${COMPANY}:conversation:${CONVERSATION}`,
      ]);
    });
  });
});

describe('CCOM1 Agency realtime gateway security', () => {
  function build(options: { resolveScope?: jest.Mock } = {}) {
    const resolveScope =
      options.resolveScope ??
      jest.fn(() =>
        Promise.resolve({
          tenantId: TENANT,
          workspaceId: WORKSPACE,
          agencyClientId: randomUUID(),
          companyContextId: COMPANY,
        }),
      );

    const gateway = new AgencyClientConversationsGateway(
      jwt,
      config(CLIENT_SECRET, AGENCY_SECRET),
      { resolveScope } as never,
      {
        findAccessible: jest.fn(() => Promise.resolve({ id: CONVERSATION })),
        ensureDefaultConversation: jest.fn(() =>
          Promise.resolve({ id: CONVERSATION }),
        ),
      } as never,
      new TenantContextAuthority({
        getRepository: () => ({
          findOne: jest.fn(() =>
            Promise.resolve({ id: 'membership', role: 'member' }),
          ),
        }),
      } as never),
    );

    return { gateway, resolveScope };
  }

  it('accepts an Agency access token', async () => {
    const { gateway } = build();
    const stub = socketStub({ auth: { token: agencyToken() } });

    await gateway.handleConnection(stub.socket as never);

    expect(stub.disconnected).toBe(false);
    expect(stub.socket.data.auth).toMatchObject({
      userId: USER,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
    });
  });

  /**
   * §34 — the two namespaces do not share authentication. A Client Area token
   * is refused here even when signed with the Agency secret, because the
   * presence of `typ` alone disqualifies it.
   */
  it.each([
    ['a Client Area token', { auth: { token: clientToken() } }],
    [
      'a Client Area token signed with the Agency secret',
      { auth: { token: clientToken({}, AGENCY_SECRET) } },
    ],
    ['no token', {}],
    [
      'an Agency token signed with the client secret',
      { auth: { token: agencyToken({}, CLIENT_SECRET) } },
    ],
  ])('disconnects a socket presenting %s', async (_label, handshake) => {
    const { gateway } = build();
    const stub = socketStub(handshake);

    await gateway.handleConnection(stub.socket as never);

    expect(stub.disconnected).toBe(true);
  });

  it('joins an agency-prefixed room, distinct from the client one', async () => {
    const { gateway } = build();
    const stub = socketStub({ auth: { token: agencyToken() } });
    await gateway.handleConnection(stub.socket as never);

    await gateway.join(stub.socket as never, { companyContextId: COMPANY });

    expect(stub.joined).toEqual([
      `agency:${TENANT}:${COMPANY}:conversation:${CONVERSATION}`,
    ]);
    expect(stub.joined[0]).not.toContain('client:');
  });

  it('refuses a company the operator cannot reach', async () => {
    const { gateway } = build({
      resolveScope: jest.fn(() => Promise.reject(new Error('no access'))),
    });
    const stub = socketStub({ auth: { token: agencyToken() } });
    await gateway.handleConnection(stub.socket as never);

    const ack = await gateway.join(stub.socket as never, {
      companyContextId: OTHER_COMPANY,
    });

    expect(ack).toEqual({ ok: false, error: 'company_not_accessible' });
    expect(stub.joined).toEqual([]);
  });

  it('ignores forged scope in the payload', async () => {
    const { gateway, resolveScope } = build();
    const stub = socketStub({ auth: { token: agencyToken() } });
    await gateway.handleConnection(stub.socket as never);

    await gateway.join(
      stub.socket as never,
      {
        companyContextId: COMPANY,
        tenantId: 'other',
        workspaceId: 'other',
        userId: VICTIM,
      } as never,
    );

    // Scope resolution received the authenticated actor, not the payload's.
    expect(resolveScope).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        userId: USER,
      }),
      COMPANY,
    );
    expect(stub.joined).toEqual([
      `agency:${TENANT}:${COMPANY}:conversation:${CONVERSATION}`,
    ]);
  });

  it('emits typing as the authenticated operator', async () => {
    const { gateway } = build();
    const stub = socketStub({ auth: { token: agencyToken() } });
    await gateway.handleConnection(stub.socket as never);

    await gateway.typingStart(
      stub.socket as never,
      {
        companyContextId: COMPANY,
        userId: VICTIM,
      } as never,
    );

    expect(stub.emitted[0]).toMatchObject({
      event: 'agency-client-conversation:typing',
      payload: { userId: USER, surface: 'agency', typing: true },
    });
  });

  it('refuses events on an unauthenticated socket', async () => {
    const { gateway } = build();
    const stub = socketStub();

    expect(
      await gateway.join(stub.socket as never, { companyContextId: COMPANY }),
    ).toEqual({ ok: false, error: 'unauthenticated' });
  });
});
