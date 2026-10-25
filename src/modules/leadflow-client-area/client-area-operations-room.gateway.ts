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
import { OperationsRoomEventBusService } from '../leadflow-agents/realtime/operations-room-event-bus.service';
import {
  OPERATIONS_ROOM_RESYNC_EVENT,
  OPERATIONS_ROOM_SOCKET_EVENT,
  operationsRoomRealtimeEnabled,
} from '../leadflow-agents/realtime/operations-room-realtime.constants';
import type { OperationsRoomEventEnvelope } from '../leadflow-agents/types/operations-room.types';

const room = (companyContextId: string) =>
  `client:${companyContextId}:operations-room`;
type Payload = { companyContextId?: unknown; [key: string]: unknown };

/**
 * OR3 — the Operations Room for the Client Area. Same namespace and contract as the CA11 Inbox
 * gateway: CCOM owns connect authentication; this handler authenticates the join and every
 * delivery with the Client Area token, never the Agency transport (`/operations-room`). The
 * envelope is the one `GET room/events` already returns to the same principal; its scope comes
 * from the persisted agent (outbox worker), never from the browser.
 */
@WebSocketGateway({ namespace: '/client-area/realtime', cors: { origin: '*' } })
export class ClientAreaOperationsRoomGateway
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
    private readonly bus: OperationsRoomEventBusService,
  ) {}
  onModuleInit() {
    this.offEvent = this.bus.onEvent((event) => {
      void this.deliver(event);
    });
    this.offResync = this.bus.onResyncRequired(() => {
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
        .toLowerCase() !== 'true' ||
      !operationsRoomRealtimeEnabled() ||
      !this.bus.isReady()
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
      module: 'leadflow_agents',
    });
    if (!context.memberAccess?.leadflow_agents.available)
      throw new UnauthorizedException();
    return context;
  }
  @SubscribeMessage('client-operations-room:join')
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
  @SubscribeMessage('client-operations-room:leave')
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
  async deliver(event: OperationsRoomEventEnvelope) {
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
        client.emit(OPERATIONS_ROOM_SOCKET_EVENT, event);
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
          client.emit(OPERATIONS_ROOM_RESYNC_EVENT, {
            companyContextId: company,
            reason: 'shared_bus_reconnected',
          });
        } catch {
          companies.delete(company);
          await client.leave(room(company));
        }
      }
  }
}
