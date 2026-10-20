import {
  OnModuleInit,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { resolveClientAreaAccessSecret } from '../client-area/client-area.config';
import {
  CLIENT_AREA_TOKEN_TYPE,
  type ClientAreaTokenPayload,
} from '../client-area/client-area.types';
import { ClientAreaSessionService } from '../client-area/services/client-area-session.service';
import { ClientAreaAuthorizationService } from '../client-area/services/client-area-authorization.service';
import {
  InboxRealtimeEventBusService,
  type InboxRealtimeEvent,
} from '../inbox/realtime/inbox-realtime-event-bus.service';

const room = (companyContextId: string) => `client:${companyContextId}:inbox`;
type Payload = { companyContextId?: unknown; [key: string]: unknown };

/** Shares CCOM's namespace, never the Agency Inbox transport. CCOM owns connect authentication;
 * this handler independently authenticates join and every delivery, without disrupting CCOM rooms. */
@WebSocketGateway({ namespace: '/client-area/realtime', cors: { origin: '*' } })
export class ClientAreaInboxGateway
  implements OnModuleInit, OnModuleDestroy, OnGatewayDisconnect
{
  private readonly subscriptions = new Map<Socket, Set<string>>();
  private offEvent?: () => void;
  private offResync?: () => void;
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sessions: ClientAreaSessionService,
    private readonly authorization: ClientAreaAuthorizationService,
    private readonly bus: InboxRealtimeEventBusService,
  ) {}
  onModuleInit() {
    this.offEvent = this.bus.onEvent((event) => {
      void this.deliver(event);
    });
    this.offResync = this.bus.onResync(() => {
      void this.resync();
    });
  }
  onModuleDestroy() {
    this.offEvent?.();
    this.offResync?.();
    this.subscriptions.clear();
  }
  handleDisconnect(client: Socket) {
    this.subscriptions.delete(client);
  }
  private async context(client: Socket, companyContextId: unknown) {
    if (
      this.config
        .get<string>('CLIENT_AREA_BRIDGE_ENABLED')
        ?.trim()
        .toLowerCase() !== 'true'
    )
      throw new UnauthorizedException();
    const secret = resolveClientAreaAccessSecret(this.config);
    const raw: unknown =
      client.handshake.auth?.token ?? client.handshake.headers?.authorization;
    if (!secret || typeof raw !== 'string') throw new UnauthorizedException();
    const payload = await this.jwt.verifyAsync<ClientAreaTokenPayload>(
      raw.replace(/^Bearer /, ''),
      { secret },
    );
    if (
      payload.typ !== CLIENT_AREA_TOKEN_TYPE ||
      !payload.sub ||
      !payload.tenantId ||
      !payload.sessionId
    )
      throw new UnauthorizedException();
    const identity = await this.sessions.authenticate(payload);
    const context = await this.authorization.authorize({
      identity,
      companyContextId,
      module: 'leadflow_inbox',
    });
    if (!context.memberAccess?.leadflow_inbox.available)
      throw new UnauthorizedException();
    return context;
  }
  @SubscribeMessage('client-inbox:join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Payload,
  ) {
    try {
      const context = await this.context(client, payload?.companyContextId);
      const companies = this.subscriptions.get(client) ?? new Set<string>();
      if (companies.size >= 32 && !companies.has(context.companyContextId))
        throw new UnauthorizedException();
      await client.join(room(context.companyContextId));
      companies.add(context.companyContextId);
      this.subscriptions.set(client, companies);
      return { ok: true, companyContextId: context.companyContextId };
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  }
  @SubscribeMessage('client-inbox:leave')
  async leave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: Payload,
  ) {
    const companies = this.subscriptions.get(client);
    if (
      typeof payload?.companyContextId === 'string' &&
      companies?.has(payload.companyContextId)
    ) {
      companies.delete(payload.companyContextId);
      await client.leave(room(payload.companyContextId));
    }
    return { ok: true };
  }
  async deliver(event: InboxRealtimeEvent) {
    if (event.scopeKind !== 'company' || !event.companyContextId) return;
    for (const [client, companies] of this.subscriptions) {
      if (!companies.has(event.companyContextId)) continue;
      try {
        const context = await this.context(client, event.companyContextId);
        if (
          context.tenantId !== event.tenantId ||
          context.workspaceId !== event.workspaceId ||
          context.agencyClientId !== event.agencyClientId ||
          context.companyContextId !== event.companyContextId
        )
          continue;
        const allowed = [
          'conversationId',
          'messageId',
          'mediaId',
          'status',
          'ownershipState',
          'ownershipVersion',
          'direction',
          'messageType',
          'occurredAt',
        ];
        client.emit('inbox.event', {
          eventId: event.eventId,
          eventName: 'leadflow.inbox.conversation.updated',
          aggregateId: event.aggregateId,
          occurredAt: event.occurredAt,
          projection: Object.fromEntries(
            allowed
              .filter((key) => key in event.projection)
              .map((key) => [key, event.projection[key]]),
          ),
        });
      } catch {
        companies.delete(event.companyContextId);
        await client.leave(room(event.companyContextId));
      }
    }
  }
  private async resync() {
    for (const [client, companies] of this.subscriptions)
      for (const company of companies) {
        try {
          await this.context(client, company);
          client.emit('inbox.resync', {
            companyContextId: company,
            reason: 'listener_reconnected',
          });
        } catch {
          companies.delete(company);
          await client.leave(room(company));
        }
      }
  }
}
