import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { DataSource, Repository } from 'typeorm';
import { Namespace, Socket } from 'socket.io';
import { AgencyUserSessionEntity } from '../../agency/entities/agency-auth.entities';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { PlatformPermissionService } from '../../permissions';
import { PlatformProductKey } from '../../platform';
import { LEADFLOW_AGENTS_PERMISSIONS } from '../leadflow-agents.permissions';
import { OperationsRoomEventBusService } from './operations-room-event-bus.service';
import {
  OPERATIONS_ROOM_NAMESPACE,
  OPERATIONS_ROOM_READY_EVENT,
  OPERATIONS_ROOM_RESYNC_EVENT,
  OPERATIONS_ROOM_SOCKET_EVENT,
  operationsRoomContextRoom,
  operationsRoomRealtimeEnabled,
} from './operations-room-realtime.constants';
import { OperationsRoomRealtimeMetrics } from './operations-room-realtime.metrics';

const AGENCY_CONNECTION = 'agency';
const HANDSHAKE_LIMIT_BYTES = 16 * 1024;
const CONNECTION_WINDOW_MS = 60_000;
const CONNECTION_LIMIT_PER_WINDOW = 20;
const SESSION_REVALIDATE_MS = 60_000;

type VerifiedToken = AuthTokenPayload & { exp?: number };
type ConnectionBucket = { count: number; resetAt: number };

@WebSocketGateway({
  namespace: OPERATIONS_ROOM_NAMESPACE,
  transports: ['websocket'],
  maxHttpBufferSize: HANDSHAKE_LIMIT_BYTES,
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
export class OperationsRoomGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnApplicationShutdown
{
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(OperationsRoomGateway.name);
  private readonly connectionBuckets = new Map<string, ConnectionBucket>();
  private readonly sessionTimers = new Map<string, NodeJS.Timeout>();
  private readonly authenticatedClients = new WeakMap<Socket, VerifiedToken>();
  private unsubscribeEvent: (() => void) | null = null;
  private unsubscribeResync: (() => void) | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly permissionService: PlatformPermissionService,
    private readonly eventBus: OperationsRoomEventBusService,
    private readonly metrics: OperationsRoomRealtimeMetrics,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(AgencyUserSessionEntity, AGENCY_CONNECTION)
    private readonly sessions: Repository<AgencyUserSessionEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsers: Repository<AgencyWorkspaceUserEntity>,
  ) {}

  afterInit(): void {
    this.unsubscribeEvent = this.eventBus.onEvent((event) => {
      const room = operationsRoomContextRoom(event.tenantId, event.workspaceId);
      const delivered = this.server.adapter.rooms.get(room)?.size ?? 0;
      this.server.to(room).emit(OPERATIONS_ROOM_SOCKET_EVENT, event);
      this.metrics.delivered(delivered);
    });
    this.unsubscribeResync = this.eventBus.onResyncRequired(() => {
      this.server.emit(OPERATIONS_ROOM_RESYNC_EVENT, {
        reason: 'shared_bus_reconnected',
      });
      this.metrics.resyncSignalled();
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      if (!operationsRoomRealtimeEnabled() || !this.eventBus.isReady()) {
        throw new Error('realtime_unavailable');
      }
      this.enforceHandshakeLimits(client);
      const payload = await this.verifyClient(client);
      await this.authorize(payload);
      const room = operationsRoomContextRoom(
        payload.tenantId,
        payload.workspaceId,
      );
      this.authenticatedClients.set(client, payload);
      await client.join(room);
      const [revision] = await this.dataSource.query<
        Array<{ room_version: string }>
      >(
        `SELECT COALESCE(room_version, 0)::text AS room_version
         FROM leadflow_operations_room_revision
         WHERE tenant_id = $1 AND workspace_id = $2`,
        [payload.tenantId, payload.workspaceId],
      );
      client.emit(OPERATIONS_ROOM_READY_EVENT, {
        contractVersion: 1,
        roomVersion: revision?.room_version ?? '0',
      });
      this.metrics.connected();
      this.scheduleSessionValidation(client);
    } catch (error) {
      this.metrics.rejected();
      this.logger.warn(
        `Rejected Operations Room socket: ${sanitizedErrorCode(error)}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const timer = this.sessionTimers.get(client.id);
    if (timer) clearTimeout(timer);
    this.sessionTimers.delete(client.id);
    if (this.authenticatedClients.has(client)) this.metrics.disconnected();
    this.authenticatedClients.delete(client);
  }

  onApplicationShutdown(): void {
    this.unsubscribeEvent?.();
    this.unsubscribeResync?.();
    this.unsubscribeEvent = null;
    this.unsubscribeResync = null;
    for (const timer of this.sessionTimers.values()) clearTimeout(timer);
    this.sessionTimers.clear();
    this.server?.disconnectSockets(true);
  }

  private enforceHandshakeLimits(client: Socket): void {
    const bytes = Buffer.byteLength(
      JSON.stringify(client.handshake.auth ?? {}),
    );
    if (bytes > HANDSHAKE_LIMIT_BYTES) throw new Error('payload_too_large');
    const key = client.handshake.address || 'unknown';
    const now = Date.now();
    const current = this.connectionBuckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + CONNECTION_WINDOW_MS }
        : current;
    bucket.count += 1;
    this.connectionBuckets.set(key, bucket);
    if (bucket.count > CONNECTION_LIMIT_PER_WINDOW) {
      throw new Error('connection_rate_limited');
    }
  }

  private async verifyClient(client: Socket): Promise<VerifiedToken> {
    const token = extractToken(client);
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!token) throw new Error('missing_token');
    if (!secret) throw new Error('jwt_secret_unavailable');
    const payload = await this.jwtService.verifyAsync<VerifiedToken>(token, {
      secret,
    });
    if (
      !payload.sub ||
      !payload.tenantId ||
      !payload.workspaceId ||
      !payload.sessionId
    ) {
      throw new Error('invalid_token_context');
    }
    await this.assertSessionActive(payload);
    return payload;
  }

  private async authorize(payload: VerifiedToken): Promise<void> {
    const context = {
      tenantId: payload.tenantId,
      workspaceId: payload.workspaceId,
      userId: payload.sub,
      role: payload.role,
    };
    const [entitled, permitted] = await Promise.all([
      this.permissionService.canAccessProduct(
        context,
        PlatformProductKey.LeadFlow,
      ),
      this.permissionService.can(context, LEADFLOW_AGENTS_PERMISSIONS.view),
    ]);
    if (!entitled) throw new Error('leadflow_entitlement_denied');
    if (!permitted) throw new Error('agents_permission_denied');
  }

  private async assertSessionActive(payload: VerifiedToken): Promise<void> {
    const [session, workspaceUser] = await Promise.all([
      this.sessions.findOne({
        where: {
          id: payload.sessionId,
          tenantId: payload.tenantId,
          userId: payload.sub,
        },
      }),
      this.workspaceUsers.findOne({
        where: {
          tenantId: payload.tenantId,
          workspaceId: payload.workspaceId,
          userId: payload.sub,
          status: 'active',
        },
      }),
    ]);
    if (
      !session ||
      !workspaceUser ||
      session.revokedAt ||
      session.status === 'expired' ||
      (session.expiresAt && session.expiresAt.getTime() <= Date.now())
    ) {
      throw new Error('session_inactive');
    }
  }

  private scheduleSessionValidation(client: Socket): void {
    const payload = this.authenticatedClients.get(client);
    if (!payload) return;
    const expiresIn = payload.exp
      ? Math.max(0, payload.exp * 1_000 - Date.now())
      : SESSION_REVALIDATE_MS;
    const delay = Math.min(SESSION_REVALIDATE_MS, expiresIn);
    const timer = setTimeout(() => {
      this.sessionTimers.delete(client.id);
      void this.assertSessionActive(payload)
        .then(() => {
          if (payload.exp && payload.exp * 1_000 <= Date.now()) {
            client.disconnect(true);
            return;
          }
          if (client.connected) this.scheduleSessionValidation(client);
        })
        .catch(() => client.disconnect(true));
    }, delay);
    timer.unref();
    this.sessionTimers.set(client.id, timer);
  }
}

function extractToken(client: Socket): string | null {
  const auth: unknown = client.handshake.auth;
  const authToken =
    typeof auth === 'object' && auth !== null && 'token' in auth
      ? auth.token
      : null;
  if (typeof authToken === 'string' && authToken.trim())
    return authToken.trim();
  const raw: unknown = client.handshake.headers.authorization;
  let authorization: unknown = raw;
  if (Array.isArray(raw)) {
    const values: unknown[] = raw;
    authorization = values[0];
  }
  return typeof authorization === 'string' &&
    authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;
}

function configuredOrigins(): string[] {
  return (
    process.env.CORS_ORIGINS ??
    process.env.APP_FRONTEND_URL ??
    'http://localhost:3003'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function sanitizedErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : 'handshake_failed';
  return /^[a-z0-9_.:-]{1,80}$/i.test(message) ? message : 'handshake_failed';
}
