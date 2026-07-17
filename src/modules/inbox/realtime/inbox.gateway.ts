import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { AgencyUserSessionEntity } from '../../agency/entities/agency-auth.entities';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { PlatformPermissionService } from '../../permissions';
import { PlatformProductKey } from '../../platform';
import { InboxRealtimeEventBusService } from './inbox-realtime-event-bus.service';
import {
  INBOX_REALTIME_EVENT,
  INBOX_REALTIME_NAMESPACE,
  INBOX_REALTIME_READY,
  INBOX_REALTIME_RESYNC,
  inboxRoom,
} from './inbox-realtime.constants';

@WebSocketGateway({
  namespace: INBOX_REALTIME_NAMESPACE,
  transports: ['websocket'],
  maxHttpBufferSize: 16 * 1024,
  cors: {
    origin(origin, callback) {
      const allowed = configuredOrigins();
      if (!origin || allowed.includes(origin)) callback(null, true);
      else callback(new Error('origin_not_allowed'));
    },
    credentials: false,
  },
})
@Injectable()
export class InboxGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnApplicationShutdown
{
  @WebSocketServer() server!: Namespace;
  private offEvent: (() => void) | null = null;
  private offResync: (() => void) | null = null;
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly bus: InboxRealtimeEventBusService,
    private readonly permissions: PlatformPermissionService,
    @InjectRepository(AgencyUserSessionEntity, 'agency')
    private readonly sessions: Repository<AgencyUserSessionEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, 'agency')
    private readonly memberships: Repository<AgencyWorkspaceUserEntity>,
  ) {}
  afterInit(): void {
    this.offEvent = this.bus.onEvent((event) =>
      this.server
        .to(inboxRoom(event.tenantId, event.workspaceId))
        .emit(INBOX_REALTIME_EVENT, event),
    );
    this.offResync = this.bus.onResync(() =>
      this.server.emit(INBOX_REALTIME_RESYNC, {
        reason: 'listener_reconnected',
      }),
    );
  }
  async handleConnection(client: Socket): Promise<void> {
    try {
      if (!this.bus.isReady()) throw new Error('realtime_unavailable');
      const payload = await this.verify(client);
      await client.join(inboxRoom(payload.tenantId, payload.workspaceId));
      const clientData = client.data as Record<string, unknown>;
      clientData.scope = {
        tenantId: payload.tenantId,
        workspaceId: payload.workspaceId,
        userId: payload.sub,
      };
      client.emit(INBOX_REALTIME_READY, { contractVersion: 1 });
    } catch {
      client.disconnect(true);
    }
  }
  handleDisconnect(client: Socket): void {
    const clientData = client.data as Record<string, unknown>;
    delete clientData.scope;
  }
  onApplicationShutdown(): void {
    this.offEvent?.();
    this.offResync?.();
    this.server?.disconnectSockets(true);
  }
  private async verify(client: Socket): Promise<AuthTokenPayload> {
    const raw =
      typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token
        : client.handshake.headers.authorization;
    const token =
      typeof raw === 'string' && raw.startsWith('Bearer ')
        ? raw.slice(7)
        : typeof raw === 'string'
          ? raw
          : '';
    const secret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!token || !secret) throw new Error('invalid_auth');
    const payload = await this.jwt.verifyAsync<AuthTokenPayload>(token, {
      secret,
    });
    if (
      !payload.sub ||
      !payload.tenantId ||
      !payload.workspaceId ||
      !payload.sessionId
    )
      throw new Error('invalid_context');
    const [session, membership] = await Promise.all([
      this.sessions.findOneBy({
        id: payload.sessionId,
        tenantId: payload.tenantId,
        userId: payload.sub,
      }),
      this.memberships.findOneBy({
        tenantId: payload.tenantId,
        workspaceId: payload.workspaceId,
        userId: payload.sub,
        status: 'active',
      }),
    ]);
    if (
      !session ||
      session.revokedAt ||
      !membership ||
      (session.expiresAt && session.expiresAt <= new Date())
    )
      throw new Error('inactive_session');
    const context = {
      tenantId: payload.tenantId,
      workspaceId: payload.workspaceId,
      userId: payload.sub,
      role: payload.role,
    };
    const [entitled, ...views] = await Promise.all([
      this.permissions.canAccessProduct(context, PlatformProductKey.LeadFlow),
      this.permissions.can(
        context,
        'leadflow.inbox.conversation.view.assigned',
      ),
      this.permissions.can(context, 'leadflow.inbox.conversation.view.client'),
      this.permissions.can(context, 'leadflow.inbox.conversation.view.all'),
    ]);
    if (!entitled || !views.some(Boolean))
      throw new Error('inbox_realtime_forbidden');
    return payload;
  }
}

function configuredOrigins(): string[] {
  return (
    process.env.CORS_ORIGINS ??
    process.env.APP_FRONTEND_URL ??
    'http://localhost:3003'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
