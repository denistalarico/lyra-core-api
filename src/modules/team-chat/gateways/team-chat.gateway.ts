import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DefaultEventsMap, Server, Socket } from 'socket.io';

import { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { TeamChatChannelsService } from '../services/team-chat-channels.service';
import { TeamChatMessagesService } from '../services/team-chat-messages.service';
import type { TeamChatContext } from '../services/team-chat-access';
import { TenantContextAuthority } from '../../../common/context/tenant-context-authority.service';

/**
 * The authenticated identity of a socket, derived from the handshake JWT and
 * stored server-side. It is the ONLY source of identity for every handler in
 * this gateway; nothing an event payload claims about who the caller is can
 * reach it.
 */
type TeamChatSocketAuth = {
  userId: string;
  tenantId: string;
  workspaceId: string;
  role: string;
};

/**
 * Channel-scoped event payloads.
 *
 * `channelId` is the only field the client may supply. Before CCOM0.5 these
 * payloads also carried `tenantId`, `workspaceId` and `userId`, and the gateway
 * trusted all three: anyone who reached the socket could join any room and
 * persist messages as any user. The fields are gone from the types, and any that
 * still arrive on the wire from an older client are ignored rather than read.
 */
type ChannelPayload = {
  channelId?: unknown;
};

type SendMessagePayload = ChannelPayload & {
  kind?: 'text' | 'audio' | 'attachment' | 'system' | 'meeting_event';
  body?: string;
  parentMessageId?: string;
  senderDisplayName?: string;
};

type TypingPayload = ChannelPayload & {
  displayName?: string;
};

type AckFailure = { ok: false; error: string };

/**
 * `Socket['data']` is `any` by default, which would silently defeat the checks
 * that read the authenticated context. Naming the type here makes
 * `client.data.auth` checked rather than assumed.
 */
type TeamChatSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  { auth?: TeamChatSocketAuth }
>;

@WebSocketGateway({
  namespace: '/agency/team-chat',
  cors: {
    origin: '*',
  },
})
export class TeamChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TeamChatGateway.name);

  constructor(
    private readonly messagesService: TeamChatMessagesService,
    private readonly channelsService: TeamChatChannelsService,
    private readonly jwtService: JwtService,
    private readonly tenantContextAuthority: TenantContextAuthority,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Authenticates the handshake, following `NotificationsGateway` — the pattern
   * that already existed in this repo and that this gateway lacked entirely.
   *
   * Identity is derived from the Agency access token and cached on
   * `socket.data.auth`. Any failure disconnects: no unauthenticated socket stays
   * connected to this namespace.
   */
  async handleConnection(client: TeamChatSocket): Promise<void> {
    try {
      // SEC-A1: same authority as HTTP — membership required, live role.
      const payload = await this.tenantContextAuthority.authorize(
        await this.verifyClientToken(client),
        {},
        'socket',
      );

      const auth: TeamChatSocketAuth = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        workspaceId: payload.workspaceId,
        role: payload.role,
      };

      client.data.auth = auth;

      this.logger.debug(`Team Chat socket connected: ${client.id}`);
    } catch (error) {
      this.logger.warn(
        `Rejected team-chat socket ${client.id}: ${
          error instanceof Error ? error.message : 'invalid handshake'
        }`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: TeamChatSocket) {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('team-chat:join-channel')
  async joinChannel(
    @ConnectedSocket() client: TeamChatSocket,
    @MessageBody() payload: ChannelPayload,
  ) {
    const auth = this.getAuth(client);
    if (!auth) return this.denied('unauthenticated');

    const channelId = this.readChannelId(payload);
    if (!channelId) return this.denied('invalid_channel_id');

    // The channel must exist, belong to the authenticated tenant/workspace and
    // be one this user may access — checked before `join()`, not after.
    const authorized = await this.authorizeChannel(
      auth,
      channelId,
      'socket.join_channel',
    );
    if (!authorized) return this.denied('channel_not_accessible');

    const room = this.getChannelRoom(
      auth.tenantId,
      auth.workspaceId,
      channelId,
    );

    await client.join(room);

    client.to(room).emit('team-chat:user-joined-channel', {
      channelId,
      userId: auth.userId,
      socketId: client.id,
    });

    return {
      ok: true,
      room,
      channelId,
    };
  }

  @SubscribeMessage('team-chat:leave-channel')
  async leaveChannel(
    @ConnectedSocket() client: TeamChatSocket,
    @MessageBody() payload: ChannelPayload,
  ) {
    const auth = this.getAuth(client);
    if (!auth) return this.denied('unauthenticated');

    const channelId = this.readChannelId(payload);
    if (!channelId) return this.denied('invalid_channel_id');

    // Leaving needs no channel authorization — a socket may always stop
    // listening — but the room and the announced identity still come from the
    // authenticated context, so nobody can leave on another user's behalf (§14).
    const room = this.getChannelRoom(
      auth.tenantId,
      auth.workspaceId,
      channelId,
    );

    await client.leave(room);

    client.to(room).emit('team-chat:user-left-channel', {
      channelId,
      userId: auth.userId,
      socketId: client.id,
    });

    return {
      ok: true,
      room,
      channelId,
    };
  }

  @SubscribeMessage('team-chat:send-message')
  async sendMessage(
    @ConnectedSocket() client: TeamChatSocket,
    @MessageBody() payload: SendMessagePayload,
  ) {
    const auth = this.getAuth(client);
    if (!auth) return this.denied('unauthenticated');

    const channelId = this.readChannelId(payload);
    if (!channelId) return this.denied('invalid_channel_id');

    // `senderUserId` is never read from the payload: the message is persisted
    // for `context.userId`, which is the handshake identity. A socket
    // authenticated as A cannot write as B (§10/§33).
    const context = this.toContext(auth);

    let message: Awaited<ReturnType<TeamChatMessagesService['create']>>;

    try {
      message = await this.messagesService.create(context, channelId, {
        kind: payload.kind as never,
        body: payload.body,
        parentMessageId: payload.parentMessageId,
        senderDisplayName: payload.senderDisplayName,
      });
    } catch (error) {
      // `create()` runs the same access primitive as REST, so an unauthorized
      // channel fails here rather than persisting anything.
      this.logger.warn(
        `Team Chat socket send denied: channelId=${channelId} ` +
          `userId=${auth.userId} tenantId=${auth.tenantId} ` +
          `reason=${error instanceof Error ? error.message : 'unknown'}`,
      );
      return this.denied('message_not_allowed');
    }

    const room = this.getChannelRoom(
      auth.tenantId,
      auth.workspaceId,
      channelId,
    );

    // Broadcast to all OTHER clients in the room (sender gets message via ACK callback)
    client.to(room).emit('team-chat:message-created', message);

    // Return message directly so the sender's ACK callback gets the persisted message
    return message;
  }

  @SubscribeMessage('team-chat:typing-start')
  async typingStart(
    @ConnectedSocket() client: TeamChatSocket,
    @MessageBody() payload: TypingPayload,
  ) {
    return this.emitTyping(client, payload, true);
  }

  @SubscribeMessage('team-chat:typing-stop')
  async typingStop(
    @ConnectedSocket() client: TeamChatSocket,
    @MessageBody() payload: TypingPayload,
  ) {
    return this.emitTyping(client, payload, false);
  }

  @SubscribeMessage('team-chat:mark-read')
  async markRead(
    @ConnectedSocket() client: TeamChatSocket,
    @MessageBody() payload: ChannelPayload,
  ) {
    const auth = this.getAuth(client);
    if (!auth) return this.denied('unauthenticated');

    const channelId = this.readChannelId(payload);
    if (!channelId) return this.denied('invalid_channel_id');

    const context = this.toContext(auth);

    let readState: Awaited<ReturnType<TeamChatMessagesService['markAsRead']>>;

    try {
      // `markAsRead` runs the access primitive, so read state of a channel the
      // user cannot access is never updated (§12).
      readState = await this.messagesService.markAsRead(context, channelId);
    } catch {
      return this.denied('channel_not_accessible');
    }

    const room = this.getChannelRoom(
      auth.tenantId,
      auth.workspaceId,
      channelId,
    );

    this.server.to(room).emit('team-chat:channel-read', {
      channelId,
      userId: auth.userId,
      readState,
    });

    return {
      ok: true,
      readState,
    };
  }

  /**
   * Pushes a message created outside a socket — by REST, or by another module
   * posting on behalf of the platform — to everyone watching the channel.
   *
   * `client.to(room)` in the socket handler above excludes the sender, which is
   * right when a person typed the message. Here there is no sender socket to
   * exclude, so the server broadcasts to the whole room.
   */
  broadcastMessageCreated(
    tenantId: string,
    workspaceId: string,
    channelId: string,
    message: unknown,
  ): void {
    this.server
      ?.to(this.getChannelRoom(tenantId, workspaceId, channelId))
      .emit('team-chat:message-created', message);
  }

  private async emitTyping(
    client: TeamChatSocket,
    payload: TypingPayload,
    typing: boolean,
  ): Promise<{ ok: true } | AckFailure> {
    const auth = this.getAuth(client);
    if (!auth) return this.denied('unauthenticated');

    const channelId = this.readChannelId(payload);
    if (!channelId) return this.denied('invalid_channel_id');

    // Typing reveals who is active in a channel, so it is authorized like any
    // other channel read, and the emitted identity is the authenticated one —
    // never a `userId` from the payload (§13).
    const authorized = await this.authorizeChannel(
      auth,
      channelId,
      typing ? 'socket.typing_start' : 'socket.typing_stop',
    );
    if (!authorized) return this.denied('channel_not_accessible');

    const room = this.getChannelRoom(
      auth.tenantId,
      auth.workspaceId,
      channelId,
    );

    client.to(room).emit('team-chat:user-typing', {
      channelId,
      userId: auth.userId,
      displayName: payload.displayName ?? null,
      socketId: client.id,
      typing,
    });

    return { ok: true };
  }

  /** Runs the shared REST/socket access primitive; never throws at the client. */
  private async authorizeChannel(
    auth: TeamChatSocketAuth,
    channelId: string,
    action: string,
  ): Promise<boolean> {
    try {
      await this.channelsService.assertChannelAccess(
        this.toContext(auth),
        channelId,
        action,
      );
      return true;
    } catch {
      return false;
    }
  }

  private getAuth(client: TeamChatSocket): TeamChatSocketAuth | null {
    const auth = client.data?.auth;

    if (!auth?.userId || !auth.tenantId || !auth.workspaceId) {
      return null;
    }

    return auth;
  }

  private toContext(auth: TeamChatSocketAuth): TeamChatContext {
    return {
      tenantId: auth.tenantId,
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      role: auth.role,
    };
  }

  private readChannelId(payload: ChannelPayload | undefined): string | null {
    const channelId = payload?.channelId;

    if (typeof channelId !== 'string' || !channelId.trim()) {
      return null;
    }

    return channelId.trim();
  }

  private denied(error: string): AckFailure {
    return { ok: false, error };
  }

  /**
   * Verifies the Agency access token from the handshake.
   *
   * Mirrors `JwtStrategy.validate`: an Agency access token carries neither `typ`
   * nor `type`, so a Client Area token (`typ='client_area'`) and a 2FA challenge
   * token (`type='agency-2fa'`) are both refused here even if a secret were ever
   * misconfigured to the same value (§3).
   */
  private async verifyClientToken(
    client: TeamChatSocket,
  ): Promise<AuthTokenPayload> {
    const token = this.extractToken(client);
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

    if (!token) {
      throw new Error('missing token');
    }

    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    const payload = await this.jwtService.verifyAsync<
      AuthTokenPayload & { typ?: unknown; type?: unknown }
    >(token, { secret });

    if (payload.typ !== undefined || payload.type !== undefined) {
      throw new Error('token is not an agency access token');
    }

    if (!payload.sub || !payload.tenantId || !payload.workspaceId) {
      throw new Error('invalid token payload');
    }

    return payload;
  }

  private extractToken(client: TeamChatSocket): string | null {
    const handshakeAuth = client.handshake.auth as
      | Record<string, unknown>
      | undefined;
    const authToken = handshakeAuth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const headers = client.handshake.headers as Record<string, unknown>;
    const header = headers.authorization;
    const authorization = Array.isArray(header)
      ? (header as unknown[])[0]
      : header;

    if (
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ')
    ) {
      return authorization.slice('Bearer '.length).trim();
    }

    return null;
  }

  private getChannelRoom(
    tenantId: string,
    workspaceId: string,
    channelId: string,
  ) {
    return `agency:${tenantId}:${workspaceId}:team-chat:channel:${channelId}`;
  }
}
