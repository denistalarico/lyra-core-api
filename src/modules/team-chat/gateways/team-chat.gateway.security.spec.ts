import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { TeamChatGateway } from './team-chat.gateway';
import { TenantContextAuthority } from '../../../common/context/tenant-context-authority.service';

/**
 * Socket security matrix for the Team Chat gateway (CCOM0.5 §32, §33).
 *
 * Before this sprint the gateway had no authentication at all: `tenantId`,
 * `workspaceId` and `userId` came from each event payload, so anyone who reached
 * the socket could join any room and persist messages as any user. These tests
 * exercise the real gateway with a real `JwtService`, stubbing only the
 * repositories' service layer.
 */

const ACCESS_SECRET = 'test-access-secret';
const CLIENT_AREA_SECRET = 'test-client-area-secret';

const jwtService = new JwtService({});

const configService = {
  get: (key: string) =>
    key === 'JWT_ACCESS_SECRET' ? ACCESS_SECRET : undefined,
} as unknown as ConfigService;

function agencyToken(
  overrides: Record<string, unknown> = {},
  secret = ACCESS_SECRET,
) {
  return jwtService.sign(
    {
      sub: 'user-a',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      role: 'member',
      sessionId: 'session-a',
      email: 'a@example.com',
      ...overrides,
    },
    { secret },
  );
}

type SocketStub = {
  id: string;
  handshake: {
    auth: Record<string, unknown>;
    headers: Record<string, unknown>;
  };
  data: Record<string, unknown>;
  join: jest.Mock;
  leave: jest.Mock;
  to: jest.Mock;
  disconnect: jest.Mock;
  emitted: { room: string; event: string; payload: unknown }[];
};

function createSocket(token?: string): SocketStub {
  const emitted: { room: string; event: string; payload: unknown }[] = [];

  const socket: SocketStub = {
    id: 'socket-1',
    handshake: { auth: token ? { token } : {}, headers: {} },
    data: {},
    join: jest.fn(),
    leave: jest.fn(),
    to: jest.fn((room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    })),
    disconnect: jest.fn(),
    emitted,
  };

  return socket;
}

function createGateway(
  overrides: {
    create?: jest.Mock;
    markAsRead?: jest.Mock;
    assertChannelAccess?: jest.Mock;
    findMembership?: jest.Mock;
  } = {},
) {
  const messagesService = {
    create:
      overrides.create ?? jest.fn().mockResolvedValue({ id: 'message-1' }),
    markAsRead:
      overrides.markAsRead ??
      jest.fn().mockResolvedValue({ channelId: 'channel-a' }),
  };
  const channelsService = {
    assertChannelAccess:
      overrides.assertChannelAccess ??
      jest.fn().mockResolvedValue({ id: 'channel-a' }),
  };

  // The real SEC-A1 authority over a stubbed membership lookup.
  const findMembership =
    overrides.findMembership ??
    jest.fn().mockResolvedValue({ id: 'membership-a', role: 'member' });
  const tenantContextAuthority = new TenantContextAuthority({
    getRepository: () => ({ findOne: findMembership }),
  } as never);

  const gateway = new TeamChatGateway(
    messagesService as never,
    channelsService as never,
    jwtService,
    tenantContextAuthority,
    configService,
  );

  gateway.server = {
    to: jest.fn(() => ({ emit: jest.fn() })),
  } as never;

  return { gateway, messagesService, channelsService };
}

describe('TeamChatGateway handshake', () => {
  it('accepts a valid agency token and derives context server-side', async () => {
    const { gateway } = createGateway();
    const socket = createSocket(agencyToken());

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.data.auth).toEqual({
      userId: 'user-a',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      role: 'member',
    });
  });

  it('rejects a valid token without an active membership (SEC-A1)', async () => {
    const { gateway } = createGateway({
      findMembership: jest.fn().mockResolvedValue(null),
    });
    const socket = createSocket(agencyToken());

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.data.auth).toBeUndefined();
  });

  it('takes the role from the live membership, not the token (SEC-A1)', async () => {
    const { gateway } = createGateway();
    const socket = createSocket(agencyToken({ role: 'owner' }));

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.data.auth).toMatchObject({ role: 'member' });
  });

  it('rejects a connection with no token', async () => {
    const { gateway } = createGateway();
    const socket = createSocket();

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.data.auth).toBeUndefined();
  });

  it('rejects a Client Area token', async () => {
    const { gateway } = createGateway();
    // Signed with the agency secret on purpose: the `typ` claim alone must be
    // enough to refuse it, even if the secrets were ever misconfigured.
    const socket = createSocket(agencyToken({ typ: 'client_area' }));

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects a 2FA challenge token', async () => {
    const { gateway } = createGateway();
    const socket = createSocket(agencyToken({ type: 'agency-2fa' }));

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects a token signed with another secret', async () => {
    const { gateway } = createGateway();
    const socket = createSocket(agencyToken({}, CLIENT_AREA_SECRET));

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects an expired token', async () => {
    const { gateway } = createGateway();
    const expired = jwtService.sign(
      {
        sub: 'user-a',
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        role: 'member',
      },
      { secret: ACCESS_SECRET, expiresIn: '-1s' },
    );
    const socket = createSocket(expired);

    await gateway.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});

describe('TeamChatGateway join-channel', () => {
  async function connected(overrides = {}) {
    const harness = createGateway(overrides);
    const socket = createSocket(agencyToken());
    await harness.gateway.handleConnection(socket as never);
    return { ...harness, socket };
  }

  it('joins the room derived from the authenticated context', async () => {
    const { gateway, socket } = await connected();

    const result = await gateway.joinChannel(socket as never, {
      channelId: 'channel-a',
    });

    expect(socket.join).toHaveBeenCalledWith(
      'agency:tenant-a:workspace-a:team-chat:channel:channel-a',
    );
    expect(result).toMatchObject({ ok: true, channelId: 'channel-a' });
  });

  it('denies joining a channel the user cannot access', async () => {
    const { gateway, socket } = await connected({
      assertChannelAccess: jest.fn().mockRejectedValue(new Error('not found')),
    });

    const result = await gateway.joinChannel(socket as never, {
      channelId: 'channel-b',
    });

    expect(result).toEqual({ ok: false, error: 'channel_not_accessible' });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('ignores forged tenant, workspace and user in the payload', async () => {
    const { gateway, socket, channelsService } = await connected();

    await gateway.joinChannel(
      socket as never,
      {
        channelId: 'channel-a',
        // A pre-CCOM0.5 client — or an attacker — supplying someone else's context.
        tenantId: 'tenant-evil',
        workspaceId: 'workspace-evil',
        userId: 'victim',
      } as never,
    );

    // The room and the authorization context both come from the token.
    expect(socket.join).toHaveBeenCalledWith(
      'agency:tenant-a:workspace-a:team-chat:channel:channel-a',
    );
    expect(channelsService.assertChannelAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        userId: 'user-a',
      }),
      'channel-a',
      expect.any(String),
    );
  });

  it('denies every channel event on an unauthenticated socket', async () => {
    const { gateway } = createGateway();
    const socket = createSocket();

    await expect(
      gateway.joinChannel(socket as never, { channelId: 'channel-a' }),
    ).resolves.toEqual({ ok: false, error: 'unauthenticated' });
    await expect(
      gateway.sendMessage(socket as never, {
        channelId: 'channel-a',
        body: 'x',
      }),
    ).resolves.toEqual({ ok: false, error: 'unauthenticated' });
    await expect(
      gateway.markRead(socket as never, { channelId: 'channel-a' }),
    ).resolves.toEqual({ ok: false, error: 'unauthenticated' });
    await expect(
      gateway.typingStart(socket as never, { channelId: 'channel-a' }),
    ).resolves.toEqual({ ok: false, error: 'unauthenticated' });
  });

  it('rejects a missing or non-string channelId', async () => {
    const { gateway, socket } = await connected();

    await expect(gateway.joinChannel(socket as never, {})).resolves.toEqual({
      ok: false,
      error: 'invalid_channel_id',
    });
    await expect(
      gateway.joinChannel(socket as never, { channelId: 42 }),
    ).resolves.toEqual({ ok: false, error: 'invalid_channel_id' });
  });
});

describe('TeamChatGateway send-message actor', () => {
  it('persists the authenticated user, never a payload senderUserId', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'message-1' });
    const { gateway } = createGateway({ create });
    const socket = createSocket(agencyToken({ sub: 'user-a' }));
    await gateway.handleConnection(socket as never);

    // The §33 impersonation test: a socket authenticated as A claims to be B.
    await gateway.sendMessage(
      socket as never,
      {
        channelId: 'channel-a',
        body: 'olá',
        userId: 'user-b',
        senderUserId: 'user-b',
        tenantId: 'tenant-evil',
        workspaceId: 'workspace-evil',
      } as never,
    );

    expect(create).toHaveBeenCalledTimes(1);
    const [context, channelId, dto] = create.mock.calls[0];

    expect(context).toEqual({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      role: 'member',
    });
    expect(channelId).toBe('channel-a');
    // Nothing identity-bearing survives from the payload into the DTO.
    expect(dto).not.toHaveProperty('senderUserId');
    expect(dto).not.toHaveProperty('userId');
  });

  it('denies sending to a channel the user cannot access', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('Canal não encontrado.'));
    const { gateway } = createGateway({ create });
    const socket = createSocket(agencyToken());
    await gateway.handleConnection(socket as never);

    const result = await gateway.sendMessage(socket as never, {
      channelId: 'channel-b',
      body: 'olá',
    });

    expect(result).toEqual({ ok: false, error: 'message_not_allowed' });
  });
});

describe('TeamChatGateway typing and read', () => {
  it('emits the authenticated identity for typing, not the payload one', async () => {
    const { gateway } = createGateway();
    const socket = createSocket(agencyToken({ sub: 'user-a' }));
    await gateway.handleConnection(socket as never);

    await gateway.typingStart(
      socket as never,
      {
        channelId: 'channel-a',
        displayName: 'Ana',
        userId: 'victim',
      } as never,
    );

    expect(socket.emitted).toHaveLength(1);
    expect(socket.emitted[0]).toMatchObject({
      room: 'agency:tenant-a:workspace-a:team-chat:channel:channel-a',
      event: 'team-chat:user-typing',
      payload: { userId: 'user-a', typing: true },
    });
  });

  it('denies typing in a channel the user cannot access', async () => {
    const { gateway } = createGateway({
      assertChannelAccess: jest.fn().mockRejectedValue(new Error('not found')),
    });
    const socket = createSocket(agencyToken());
    await gateway.handleConnection(socket as never);

    const result = await gateway.typingStart(socket as never, {
      channelId: 'channel-b',
    });

    expect(result).toEqual({ ok: false, error: 'channel_not_accessible' });
    expect(socket.emitted).toHaveLength(0);
  });

  it('marks read as the authenticated user and denies inaccessible channels', async () => {
    const markAsRead = jest.fn().mockResolvedValue({ channelId: 'channel-a' });
    const { gateway } = createGateway({ markAsRead });
    const socket = createSocket(agencyToken());
    await gateway.handleConnection(socket as never);

    await gateway.markRead(
      socket as never,
      {
        channelId: 'channel-a',
        userId: 'victim',
      } as never,
    );

    expect(markAsRead).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-a' }),
      'channel-a',
    );

    const denied = createGateway({
      markAsRead: jest
        .fn()
        .mockRejectedValue(new Error('Canal não encontrado.')),
    });
    const deniedSocket = createSocket(agencyToken());
    await denied.gateway.handleConnection(deniedSocket as never);

    await expect(
      denied.gateway.markRead(deniedSocket as never, {
        channelId: 'channel-b',
      }),
    ).resolves.toEqual({ ok: false, error: 'channel_not_accessible' });
  });

  it('leaves a room without acting as another user', async () => {
    const { gateway } = createGateway();
    const socket = createSocket(agencyToken({ sub: 'user-a' }));
    await gateway.handleConnection(socket as never);

    await gateway.leaveChannel(
      socket as never,
      {
        channelId: 'channel-a',
        userId: 'victim',
        tenantId: 'tenant-evil',
      } as never,
    );

    expect(socket.leave).toHaveBeenCalledWith(
      'agency:tenant-a:workspace-a:team-chat:channel:channel-a',
    );
    expect(socket.emitted[0].payload).toMatchObject({ userId: 'user-a' });
  });
});
