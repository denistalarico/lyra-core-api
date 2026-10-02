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
import { resolveClientAreaAccessSecret } from '../../client-area/client-area.config';
import { ClientAreaAuthorizationService } from '../../client-area/services/client-area-authorization.service';
import { ClientAreaSessionService } from '../../client-area/services/client-area-session.service';
import {
  CLIENT_AREA_TOKEN_TYPE,
  type ClientAreaContext,
  type ClientAreaTokenPayload,
} from '../../client-area/client-area.types';
import { toCompanyAwareScope } from '../../client-area/client-area-scope';
import { ClientConversationsService } from '../services/client-conversations.service';
import {
  conversationRoom,
  toConversationScope,
} from '../services/client-conversation-access';

/**
 * The authenticated identity of a client socket. Derived from the handshake
 * token and the live session, stored server-side, and the only source of
 * identity any handler reads.
 */
type ClientSocketAuth = {
  userId: string;
  tenantId: string;
  sessionId: string;
  email: string;
};

/**
 * The only field a client may supply. There is deliberately no `tenantId`,
 * `companyContextId` or `userId` in this type: the Agency chat trusted exactly
 * those three from the payload, and three guessed UUIDs bought a seat in any
 * room (CCOM0.5 §3). Anything extra that arrives on the wire is ignored, not
 * read.
 */
type ConversationPayload = {
  companyContextId?: unknown;
  conversationId?: unknown;
};

type AckFailure = { ok: false; error: string };

type ClientSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  { auth?: ClientSocketAuth }
>;

/**
 * CCOM1 — the Client Area realtime namespace (§30–§33).
 *
 * A namespace of its own, not a shared one. The isolation is structural rather
 * than policy-based, on three independent axes:
 *
 *   secret     `JWT_CLIENT_AREA_ACCESS_SECRET`, never `JWT_ACCESS_SECRET`
 *   claim      `typ='client_area'` required — an Agency token has no `typ`
 *   room       prefixed `client:`, so even the same conversation is a
 *              different room than the Agency side watches
 *
 * So an Agency JWT cannot connect here (wrong secret *and* missing claim), and
 * a Client Area JWT cannot connect to `/agency/team-chat` (which refuses any
 * token carrying `typ`). Neither rejection depends on a filter being
 * remembered.
 *
 * AUTHORIZATION IS RE-RUN, NOT CACHED
 * -----------------------------------
 * The handshake proves the person; it proves nothing about companies. Every
 * company-scoped event re-runs the full Client Area authorization formula —
 * live session, active membership, company, organization, Agency Client, CRM
 * eligibility, module, permission — through the same
 * `ClientAreaAuthorizationService` the REST guards use. That is what makes a
 * revoked membership lose realtime access on its next event rather than at
 * token expiry (§26/§52).
 */
@WebSocketGateway({
  namespace: '/client-area/realtime',
  cors: { origin: '*' },
})
export class ClientConversationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ClientConversationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessions: ClientAreaSessionService,
    private readonly authorization: ClientAreaAuthorizationService,
    private readonly conversations: ClientConversationsService,
  ) {}

  async handleConnection(client: ClientSocket): Promise<void> {
    try {
      const payload = await this.verifyToken(client);
      // The live `surface='client_area'` session row, not just a valid
      // signature: a logged-out or revoked session is refused at connect.
      const identity = await this.sessions.authenticate(payload);

      client.data.auth = {
        userId: identity.userId,
        tenantId: identity.tenantId,
        sessionId: identity.sessionId,
        email: identity.email,
      };
    } catch (error) {
      this.logger.warn(
        `Rejected client-area socket ${client.id}: ${
          error instanceof Error ? error.message : 'invalid handshake'
        }`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: ClientSocket): void {
    this.logger.debug(`Client-area socket disconnected: ${client.id}`);
  }

  /**
   * Joins the room of the caller's own company conversation.
   *
   * The room name is *built* from the context the authorization produced, never
   * taken from the payload — so a client naming an arbitrary room, or another
   * company's ids, joins nothing (§32/§52).
   */
  @SubscribeMessage('client-conversation:join')
  async join(
    @ConnectedSocket() client: ClientSocket,
    @MessageBody() payload: ConversationPayload,
  ) {
    const resolved = await this.resolve(client, payload);
    if ('error' in resolved) return resolved.error;

    const { context, conversationId } = resolved;
    const room = conversationRoom(
      'client_area',
      toConversationScope(toCompanyAwareScope(context)),
      conversationId,
    );

    await client.join(room);
    return { ok: true as const, conversationId };
  }

  @SubscribeMessage('client-conversation:leave')
  async leave(
    @ConnectedSocket() client: ClientSocket,
    @MessageBody() payload: ConversationPayload,
  ) {
    const auth = this.getAuth(client);
    if (!auth) return this.denied('unauthenticated');

    // Leaving needs no authorization — a socket may always stop listening — but
    // the room is still derived from validated context, so nobody can make
    // another viewer leave.
    const resolved = await this.resolve(client, payload);
    if ('error' in resolved) return resolved.error;

    const room = conversationRoom(
      'client_area',
      toConversationScope(toCompanyAwareScope(resolved.context)),
      resolved.conversationId,
    );

    await client.leave(room);
    return { ok: true as const };
  }

  @SubscribeMessage('client-conversation:typing-start')
  typingStart(
    @ConnectedSocket() client: ClientSocket,
    @MessageBody() payload: ConversationPayload,
  ) {
    return this.emitTyping(client, payload, true);
  }

  @SubscribeMessage('client-conversation:typing-stop')
  typingStop(
    @ConnectedSocket() client: ClientSocket,
    @MessageBody() payload: ConversationPayload,
  ) {
    return this.emitTyping(client, payload, false);
  }

  /**
   * Typing is authorized like a read, because it reveals who is active in a
   * conversation, and the emitted identity is the authenticated one.
   */
  private async emitTyping(
    client: ClientSocket,
    payload: ConversationPayload,
    typing: boolean,
  ) {
    const resolved = await this.resolve(client, payload);
    if ('error' in resolved) return resolved.error;

    const { context, conversationId } = resolved;
    const room = conversationRoom(
      'client_area',
      toConversationScope(toCompanyAwareScope(context)),
      conversationId,
    );

    client.to(room).emit('client-conversation:typing', {
      conversationId,
      surface: 'client_area' as const,
      userId: context.userId,
      typing,
    });

    return { ok: true as const };
  }

  /**
   * Pushes a message to both surfaces watching a conversation.
   *
   * Called by the REST boundaries after a message is persisted, so a message
   * sent over HTTP still reaches live viewers. The two rooms are emitted to
   * separately and carry the same persisted projection — nothing client-unsafe
   * exists in it, since the projection is built field by field for the client
   * surface in the first place.
   */
  broadcastMessageCreated(input: {
    tenantId: string;
    companyContextId: string;
    conversationId: string;
    message: unknown;
  }): void {
    const room = conversationRoom(
      'client_area',
      { tenantId: input.tenantId, companyContextId: input.companyContextId },
      input.conversationId,
    );

    this.server?.to(room).emit('client-conversation:message-created', {
      conversationId: input.conversationId,
      message: input.message,
    });
  }

  /**
   * CCOM2 §43/§45 — the timeline changed somewhere other than this domain's
   * tables: a client-visible approval comment was written, or a decision moved
   * an approval's status.
   *
   * Carries no content on purpose. The comment is canonical in
   * `social_approval_comments` and the status is resolved on read, so the only
   * honest signal is "re-read the page" — a payload here would either duplicate
   * the text that §13 refuses to duplicate, or ship a status that §4 refuses to
   * persist. The receiver re-fetches through the same authorized route, which
   * means a listener whose access just changed re-proves it.
   */
  broadcastTimelineChanged(input: {
    tenantId: string;
    companyContextId: string;
    conversationId: string;
    approvalId: string;
    reason: string;
  }): void {
    const room = conversationRoom(
      'client_area',
      { tenantId: input.tenantId, companyContextId: input.companyContextId },
      input.conversationId,
    );

    this.server?.to(room).emit('client-conversation:timeline-changed', {
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
    const room = conversationRoom(
      'client_area',
      { tenantId: input.tenantId, companyContextId: input.companyContextId },
      input.conversationId,
    );

    this.server?.to(room).emit('client-conversation:read-updated', {
      conversationId: input.conversationId,
      surface: input.surface,
      userId: input.userId,
      lastReadAt: input.lastReadAt,
    });
  }

  /**
   * The full authorization chain for one event: authenticated socket → Client
   * Area context for the requested company → the conversation inside it.
   *
   * Returns a typed failure instead of throwing, so a denial does not drop the
   * socket; a wrong company is a refused event, not a disconnect.
   */
  private async resolve(
    client: ClientSocket,
    payload: ConversationPayload,
  ): Promise<
    | { context: ClientAreaContext; conversationId: string }
    | { error: AckFailure }
  > {
    const auth = this.getAuth(client);
    if (!auth) return { error: this.denied('unauthenticated') };

    let context: ClientAreaContext;
    try {
      context = await this.authorization.authorize({
        identity: {
          userId: auth.userId,
          tenantId: auth.tenantId,
          sessionId: auth.sessionId,
          email: auth.email,
        },
        companyContextId: payload?.companyContextId,
        module: 'conversations',
        permission: 'client_area.conversations.view',
      });
    } catch {
      return { error: this.denied('company_not_accessible') };
    }

    try {
      const conversation = payload?.conversationId
        ? await this.conversations.findAccessible(
            toConversationScope(toCompanyAwareScope(context)),
            payload.conversationId,
          )
        : await this.conversations.ensureDefaultConversation(
            toConversationScope(toCompanyAwareScope(context)),
            {
              surface: 'client_area',
              userId: context.userId,
              membershipId: context.membershipId,
            },
          );

      return { context, conversationId: conversation.id };
    } catch {
      return { error: this.denied('conversation_not_accessible') };
    }
  }

  private getAuth(client: ClientSocket): ClientSocketAuth | null {
    const auth = client.data?.auth;
    if (!auth?.userId || !auth.tenantId || !auth.sessionId) return null;
    return auth;
  }

  private denied(error: string): AckFailure {
    return { ok: false, error };
  }

  /**
   * Verifies the handshake token against the Client Area secret and requires
   * `typ='client_area'`. The claim check is defence in depth: even if the two
   * secrets were ever misconfigured to the same value, an Agency access token
   * (which carries no `typ`) would still be refused here.
   */
  private async verifyToken(
    client: ClientSocket,
  ): Promise<ClientAreaTokenPayload> {
    const token = this.extractToken(client);
    const secret = resolveClientAreaAccessSecret(this.configService);

    if (!token) throw new Error('missing token');
    if (!secret) throw new Error('client area access secret is not configured');

    const payload = await this.jwtService.verifyAsync<
      Partial<ClientAreaTokenPayload>
    >(token, { secret });

    if (
      payload.typ !== CLIENT_AREA_TOKEN_TYPE ||
      !payload.sub ||
      !payload.tenantId ||
      !payload.sessionId
    ) {
      throw new Error('token is not a client area access token');
    }

    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      typ: CLIENT_AREA_TOKEN_TYPE,
      email: payload.email,
    };
  }

  private extractToken(client: ClientSocket): string | null {
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
