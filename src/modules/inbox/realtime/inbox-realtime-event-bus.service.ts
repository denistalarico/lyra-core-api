import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Client, Notification } from 'pg';
import { EventEmitter } from 'node:events';
import { DataSource } from 'typeorm';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import type { InboxScopeKind } from '../inbox-company-scope';
import { InboxRuntimeConfigService } from '../runtime/inbox-runtime-config.service';
import { INBOX_PG_CHANNEL } from './inbox-realtime.constants';

export type InboxRealtimeEvent = {
  eventId: string;
  idempotencyKey: string;
  eventName: string;
  eventVersion: number;
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
  scopeKind: Exclude<InboxScopeKind, 'legacy_unassigned'>;
  aggregateId: string;
  occurredAt: string;
  projection: Record<string, unknown>;
};

@Injectable()
export class InboxRealtimeEventBusService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(InboxRealtimeEventBusService.name);
  private readonly emitter = new EventEmitter();
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private ready = false;
  private everConnected = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly config: InboxRuntimeConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.realtimeGatewayEnabled) await this.connect();
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.client?.end().catch(() => undefined);
    this.client = null;
    this.emitter.removeAllListeners();
  }
  isReady(): boolean {
    return this.config.realtimeGatewayEnabled && this.ready;
  }
  onEvent(listener: (event: InboxRealtimeEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
  onResync(listener: () => void): () => void {
    this.emitter.on('resync', listener);
    return () => this.emitter.off('resync', listener);
  }

  async notify(eventId: string): Promise<void> {
    await this.dataSource.query('SELECT pg_notify($1, $2)', [
      INBOX_PG_CHANNEL,
      eventId,
    ]);
  }

  private async connect(): Promise<void> {
    if (this.stopping || this.client) return;
    const options = this.dataSource.options;
    if (options.type !== 'postgres')
      throw new Error('inbox_realtime_requires_postgres');
    const client = new Client({
      host: options.host,
      port: options.port,
      user: options.username,
      password: options.password,
      database: options.database,
      ssl: options.ssl as boolean | undefined,
      application_name: 'lyra-inbox-realtime-listener',
    });
    this.client = client;
    client.on('notification', (event) => void this.handle(event));
    client.on('error', () => this.lost());
    client.on('end', () => this.lost());
    try {
      await client.connect();
      await client.query(`LISTEN ${INBOX_PG_CHANNEL}`);
      const reconnect = this.everConnected;
      this.ready = true;
      this.everConnected = true;
      if (reconnect) this.emitter.emit('resync');
    } catch {
      this.logger.warn('Inbox realtime listener unavailable; retrying.');
      this.lost();
    }
  }
  private lost(): void {
    if (this.stopping) return;
    this.ready = false;
    const client = this.client;
    this.client = null;
    if (client) void client.end().catch(() => undefined);
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        void this.connect();
      }, 1_000);
      this.reconnectTimer.unref();
    }
  }
  private async handle(notification: Notification): Promise<void> {
    if (
      notification.channel !== INBOX_PG_CHANNEL ||
      !notification.payload ||
      !/^[0-9a-f-]{36}$/i.test(notification.payload)
    )
      return;
    const row = await this.dataSource
      .getRepository(InboxDomainOutboxEntity)
      .findOneBy({ id: notification.payload });
    if (!row) return;
    const scope = await this.resolveEventScope(row);
    if (!scope || scope.scopeKind === 'legacy_unassigned') return;
    this.emitter.emit('event', {
      eventId: row.id,
      idempotencyKey: row.idempotencyKey,
      eventName: row.eventName,
      eventVersion: row.eventVersion,
      tenantId: row.tenantId,
      workspaceId: row.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      scopeKind: scope.scopeKind,
      aggregateId: row.aggregateId,
      occurredAt: row.createdAt.toISOString(),
      projection: safeProjection(row.payload),
    } satisfies InboxRealtimeEvent);
  }

  private async resolveEventScope(row: InboxDomainOutboxEntity) {
    const payloadConversationId = row.payload?.conversationId;
    const conversationId =
      typeof payloadConversationId === 'string'
        ? payloadConversationId
        : row.aggregateType === 'inbox_conversation' ||
            row.aggregateType === 'conversation'
          ? row.aggregateId
          : null;

    if (conversationId) {
      const conversation = await this.dataSource
        .getRepository(InboxConversationEntity)
        .findOne({
          select: {
            agencyClientId: true,
            companyContextId: true,
            scopeKind: true,
          },
          where: {
            id: conversationId,
            tenantId: row.tenantId,
            workspaceId: row.workspaceId,
          },
        });
      if (conversation) return conversation;
    }

    const payloadChannelId = row.payload?.channelId;
    const channelId =
      typeof payloadChannelId === 'string'
        ? payloadChannelId
        : row.aggregateType === 'inbox_channel'
          ? row.aggregateId
          : null;

    if (!channelId) return null;
    return this.dataSource.getRepository(InboxChannelEntity).findOne({
      select: {
        agencyClientId: true,
        companyContextId: true,
        scopeKind: true,
      },
      where: {
        id: channelId,
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
      },
    });
  }
}

function safeProjection(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = [
    'conversationId',
    'messageId',
    'mediaId',
    'derivativeId',
    'batchId',
    'decisionId',
    'status',
    'ownershipState',
    'ownershipVersion',
    'direction',
    'messageType',
    'occurredAt',
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => payload[key] !== undefined)
      .map((key) => [key, payload[key]]),
  );
}
