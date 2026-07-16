import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Client, Notification } from 'pg';
import { DataSource, Repository } from 'typeorm';
import { EventEmitter } from 'node:events';
import { OperationsRoomOutboxEntity } from '../entities';
import type { OperationsRoomEventEnvelope } from '../types/operations-room.types';
import { mapOperationsRoomOutboxEvent } from './operations-room-event.mapper';
import {
  OPERATIONS_ROOM_PG_CHANNEL,
  operationsRoomRealtimeEnabled,
} from './operations-room-realtime.constants';

const AGENCY_CONNECTION = 'agency';
const RECONNECT_DELAY_MS = 1_000;

type BusEvents = {
  event: [OperationsRoomEventEnvelope];
  resync: [];
};

@Injectable()
export class OperationsRoomEventBusService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OperationsRoomEventBusService.name);
  private readonly emitter = new EventEmitter<BusEvents>();
  private client: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private ready = false;
  private everConnected = false;

  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(OperationsRoomOutboxEntity, AGENCY_CONNECTION)
    private readonly outboxRepository: Repository<OperationsRoomOutboxEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!operationsRoomRealtimeEnabled()) return;
    await this.connectListener();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    this.ready = false;
    if (client) await client.end().catch(() => undefined);
    this.emitter.removeAllListeners();
  }

  isEnabled(): boolean {
    return operationsRoomRealtimeEnabled();
  }

  isReady(): boolean {
    return this.isEnabled() && this.ready;
  }

  onEvent(listener: (event: OperationsRoomEventEnvelope) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  onResyncRequired(listener: () => void): () => void {
    this.emitter.on('resync', listener);
    return () => this.emitter.off('resync', listener);
  }

  async publish(event: OperationsRoomEventEnvelope): Promise<void> {
    if (!this.isEnabled()) throw errorWithCode('realtime_disabled');
    await this.dataSource.query('SELECT pg_notify($1, $2)', [
      OPERATIONS_ROOM_PG_CHANNEL,
      event.eventId,
    ]);
  }

  private async connectListener(): Promise<void> {
    if (this.stopping || this.client) return;
    const options = this.dataSource.options;
    if (options.type !== 'postgres') {
      throw new Error('Operations Room realtime requires PostgreSQL.');
    }

    const client = new Client({
      host: options.host,
      port: options.port,
      user: options.username,
      password: options.password,
      database: options.database,
      ssl: pgSslConfig(options.ssl),
      application_name: 'lyra-operations-room-listener',
    });
    this.client = client;
    client.on('notification', (notification) => {
      void this.handleNotification(notification);
    });
    client.on('error', () => this.listenerLost());
    client.on('end', () => this.listenerLost());

    try {
      await client.connect();
      await client.query(`LISTEN ${OPERATIONS_ROOM_PG_CHANNEL}`);
      this.ready = true;
      const reconnect = this.everConnected;
      this.everConnected = true;
      if (reconnect) this.emitter.emit('resync');
    } catch {
      this.logger.warn('Operations Room bus listener unavailable; retrying.');
      this.listenerLost();
    }
  }

  private listenerLost(): void {
    if (this.stopping) return;
    this.ready = false;
    const client = this.client;
    this.client = null;
    if (client) void client.end().catch(() => undefined);
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectListener();
    }, RECONNECT_DELAY_MS);
    this.reconnectTimer.unref();
  }

  private async handleNotification(notification: Notification): Promise<void> {
    if (
      notification.channel !== OPERATIONS_ROOM_PG_CHANNEL ||
      !notification.payload ||
      !/^[0-9a-f-]{36}$/i.test(notification.payload)
    ) {
      return;
    }
    const row = await this.outboxRepository.findOneBy({
      eventId: notification.payload,
    });
    if (row) this.emitter.emit('event', mapOperationsRoomOutboxEvent(row));
  }
}

function errorWithCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function pgSslConfig(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  return {
    ...(typeof source.rejectUnauthorized === 'boolean'
      ? { rejectUnauthorized: source.rejectUnauthorized }
      : {}),
    ...(typeof source.ca === 'string' ? { ca: source.ca } : {}),
    ...(typeof source.cert === 'string' ? { cert: source.cert } : {}),
    ...(typeof source.key === 'string' ? { key: source.key } : {}),
    ...(typeof source.servername === 'string'
      ? { servername: source.servername }
      : {}),
  };
}
