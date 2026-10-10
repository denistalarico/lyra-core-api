import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { ClientConversationsService } from '../services/client-conversations.service';
import { AgencyClientConversationAccessService } from '../services/agency-client-conversation-access.service';
import { conversationRoom } from '../services/client-conversation-access';
import { TenantContextAuthority } from '../../../common/context/tenant-context-authority.service';

type AgencySocketAuth = {
  userId: string;
  tenantId: string;
  workspaceId: string;
  role: string;
};

/**
 * `companyContextId` is the only field the client supplies; `conversationId` is
 * optional and still re-proved. No identity or scope field is accepted.
 */
type AgencyConversationPayload = {
  companyContextId?: unknown;
  conversationId?: unknown;
};

type AckFailure = { ok: false; error: string };

type AgencySocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  { auth?: AgencySocketAuth }
>;

/**
 * CCOM1 — the Agency side of Client Conversation realtime (§34).
 *
 * WHY A SEPARATE NAMESPACE RATHER THAN REUSING `TeamChatGateway`
 * -------------------------------------------------------------
 * The prompt offered reusing the (now hardened) Team Chat gateway as mere
 * transport. Three properties of the real code decided against it:
 *
 *   1. its rooms are keyed `agency:{t}:{w}:team-chat:channel:{id}` and its
 *      authorization is `evaluateChannelAccess`, which reads
 *      `agency_chat_channel_members`. A client conversation has no row there,
 *      so every event would need a second, parallel authorization path inside
 *      a gateway whose whole value is having exactly one;
 *   2. its `join-channel` would then take ids that are sometimes channels and
 *      sometimes conversations — the kind of polymorphic id that made
 *      `assertChannel` wrong in the first place;
 *   3. an accidental cross-emit would put client-facing content in an internal
 *      room, which is the one mistake this sprint exists to prevent.
 *
 * The cost of a second gateway is ~200 lines of handshake code that mirrors a
 * reviewed pattern. The cost of merging was an authorization branch inside a
 * shared primitive. Isolation won, and the infrastructure that actually matters
 * (the access primitive, the room builder, the service) *is* shared.
 *
 * Client and Agency sockets share no namespace, no secret and no room, per the
 * CCOM1 §34 requirement.
 */
@WebSocketGateway({
  namespace: '/agency/client-conversations',
  cors: { origin: '*' },
})
export class AgencyClientConversationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(AgencyClientConversationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly access: AgencyClientConversationAccessService,
    private readonly conversations: ClientConversationsService,
    private readonly tenantContextAuthority: TenantContextAuthority,
  ) {}

  async handleConnection(client: AgencySocket): Promise<void> {
    try {
      // SEC-A1: same authority as HTTP — membership required, live role.
      const payload = await this.tenantContextAuthority.authorize(
        await this.verifyToken(client),
        {},
        'socket',
      );
      client.data.auth = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        workspaceId: payload.workspaceId,
        role: payload.role,
      };
    } catch (error) {
      this.logger.warn(
        `Rejected agency client-conversation socket ${client.id}: ${
          error instanceof Error ? error.message : 'invalid handshake'
        }`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AgencySocket): void {
    this.logger.debug(`Agency client-conversation socket left: ${client.id}`);
  }

  @SubscribeMessage('agency-client-conversation:join')
  async join(
    @ConnectedSocket() client: AgencySocket,
    @MessageBody() payload: AgencyConversationPayload,
  ) {
    const resolved = await this.resolve(client, payload);
    if ('error' in resolved) return resolved.error;

    await client.join(resolved.room);
    return { ok: true as const, conversationId: resolved.conversationId };
  }

  @SubscribeMessage('agency-client-conversation:leave')
  async leave(
    @ConnectedSocket() client: AgencySocket,
    @MessageBody() payload: AgencyConversationPayload,
  ) {
    const resolved = await this.resolve(client, payload);
    if ('error' in resolved) return resolved.error;

    await client.leave(resolved.room);
    return { ok: true as const };
  }

  @SubscribeMessage('agency-client-conversation:typing-start')
  typingStart(
    @ConnectedSocket() client: AgencySocket,
    @MessageBody() payload: AgencyConversationPayload,
  ) {
    return this.emitTyping(client, payload, true);
  }

  @SubscribeMessage('agency-client-conversation:typing-stop')
  typingStop(
    @ConnectedSocket() client: AgencySocket,
    @MessageBody() payload: AgencyConversationPayload,
  ) {
    return this.emitTyping(client, payload, false);
  }

  private async emitTyping(
    client: AgencySocket,
    payload: AgencyConversationPayload,
    typing: boolean,
  ) {
    const resolved = await this.resolve(client, payload);
    if ('error' in resolved) return resolved.error;

    client.to(resolved.room).emit('agency-client-conversation:typing', {
      conversationId: resolved.conversationId,
      surface: 'agency' as const,
      userId: resolved.auth.userId,
      typing,
    });

    return { ok: true as const };
  }

  /** Fan-out of a persisted message to Agency viewers of a conversation. */
  broadcastMessageCreated(input: {
    tenantId: string;
    companyContextId: string;
    conversationId: string;
    message: unknown;
  }): void {
    this.server
      ?.to(
        conversationRoom(
          'agency',
          {
            tenantId: input.tenantId,
            companyContextId: input.companyContextId,
          },
          input.conversationId,
        ),
      )
      .emit('agency-client-conversation:message-created', {
        conversationId: input.conversationId,
        message: input.message,
      });
  }

  /**
   * CCOM2 §43/§45 — same contentless timeline signal as the client gateway,
   * emitted into the `agency:` room so the Team Chat "Clientes" pane re-reads
   * too. Separate emit into a separate room, never a shared one: the two feeds
   * stay structurally apart (CCOM1 §34), and the re-read each side performs
   * goes through its own authorized boundary.
   */
  broadcastTimelineChanged(input: {
    tenantId: string;
    companyContextId: string;
    conversationId: string;
    approvalId: string;
    reason: string;
  }): void {
    this.server
      ?.to(
        conversationRoom(
          'agency',
          {
            tenantId: input.tenantId,
            companyContextId: input.companyContextId,
          },
          input.conversationId,
        ),
      )
      .emit('agency-client-conversation:timeline-changed', {
        conversationId: input.conversationId,
        approvalId: input.approvalId,
        reason: input.reason,
      });
  }

  broadcastReadUpdated(input: {
    tenantId: string;
    companyContextId: string;
    conversationId: string;
    surface: string;
    userId: string;
    lastReadAt: Date;
  }): void {
    this.server
      ?.to(
        conversationRoom(
          'agency',
          {
            tenantId: input.tenantId,
            companyContextId: input.companyContextId,
          },
          input.conversationId,
        ),
      )
      .emit('agency-client-conversation:read-updated', {
        conversationId: input.conversationId,
        surface: input.surface,
        userId: input.userId,
        lastReadAt: input.lastReadAt,
      });
  }

  /**
   * Resolves one event: authenticated socket → operator may reach this company
   * → the conversation inside it. The same eligibility service the Agency REST
   * boundary uses, so socket and REST cannot disagree about who sees what.
   */
  private async resolve(
    client: AgencySocket,
    payload: AgencyConversationPayload,
  ): Promise<
    | { auth: AgencySocketAuth; conversationId: string; room: string }
    | { error: AckFailure }
  > {
    const auth = this.getAuth(client);
    if (!auth) return { error: this.denied('unauthenticated') };

    let scope: Awaited<
      ReturnType<AgencyClientConversationAccessService['resolveScope']>
    >;

    try {
      scope = await this.access.resolveScope(
        {
          tenantId: auth.tenantId,
          workspaceId: auth.workspaceId,
          userId: auth.userId,
          role: auth.role,
        },
        payload?.companyContextId,
      );
    } catch {
      return { error: this.denied('company_not_accessible') };
    }

    try {
      const conversation = payload?.conversationId
        ? await this.conversations.findAccessible(scope, payload.conversationId)
        : await this.conversations.ensureDefaultConversation(scope, {
            surface: 'agency',
            userId: auth.userId,
          });

      return {
        auth,
        conversationId: conversation.id,
        room: conversationRoom('agency', scope, conversation.id),
      };
    } catch {
      return { error: this.denied('conversation_not_accessible') };
    }
  }

  private getAuth(client: AgencySocket): AgencySocketAuth | null {
    const auth = client.data?.auth;
    if (!auth?.userId || !auth.tenantId || !auth.workspaceId) return null;
    return auth;
  }

  private denied(error: string): AckFailure {
    return { ok: false, error };
  }

  /**
   * Agency access token only. Mirrors `JwtStrategy.validate` and the hardened
   * `TeamChatGateway`: an Agency access token carries neither `typ` nor `type`,
   * so a Client Area token and a 2FA challenge token are both refused even if a
   * secret were misconfigured to the same value.
   */
  private async verifyToken(client: AgencySocket): Promise<AuthTokenPayload> {
    const token = this.extractToken(client);
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

    if (!token) throw new Error('missing token');
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');

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

  private extractToken(client: AgencySocket): string | null {
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
}
