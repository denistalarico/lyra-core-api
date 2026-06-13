import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { NotificationRealtimeService } from '../services/notification-realtime.service';

@WebSocketGateway({
  namespace: '/agency/notifications',
  cors: {
    origin: '*',
  },
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly realtimeService: NotificationRealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtimeService.bindServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const payload = await this.verifyClientToken(client);
      const room = NotificationRealtimeService.getUserRoom({
        tenantId: payload.tenantId,
        workspaceId: payload.workspaceId,
        userId: payload.sub,
      });
      const tenantWideRoom = NotificationRealtimeService.getUserRoom({
        tenantId: payload.tenantId,
        workspaceId: null,
        userId: payload.sub,
      });

      client.data.tenantId = payload.tenantId;
      client.data.workspaceId = payload.workspaceId;
      client.data.userId = payload.sub;

      await client.join([room, tenantWideRoom]);
      this.logger.debug(
        `Notifications socket connected: ${client.id}`,
      );
    } catch (error) {
      this.logger.warn(
        `Rejected notifications socket ${client.id}: ${
          error instanceof Error ? error.message : 'invalid handshake'
        }`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(
      `Notifications socket disconnected: ${client.id}`,
    );
  }

  private async verifyClientToken(
    client: Socket,
  ): Promise<AuthTokenPayload> {
    const token = this.extractToken(client);
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

    if (!token) {
      throw new Error('missing token');
    }

    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    const payload =
      await this.jwtService.verifyAsync<AuthTokenPayload>(token, {
        secret,
      });

    if (!payload.sub || !payload.tenantId || !payload.workspaceId) {
      throw new Error('invalid token payload');
    }

    return payload;
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.trim();
    }

    const header = client.handshake.headers.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;

    if (
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer ')
    ) {
      return authorization.slice('Bearer '.length).trim();
    }

    return null;
  }
}
