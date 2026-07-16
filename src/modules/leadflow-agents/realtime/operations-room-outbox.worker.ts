import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { OperationsRoomOutboxEntity } from '../entities';
import { RoomOutboxDeliveryState } from '../enums/room-operational.enums';
import { mapOperationsRoomOutboxEvent } from './operations-room-event.mapper';
import { OperationsRoomEventBusService } from './operations-room-event-bus.service';
import { OperationsRoomRealtimeMetrics } from './operations-room-realtime.metrics';
import { operationsRoomRealtimeEnabled } from './operations-room-realtime.constants';

const AGENCY_CONNECTION = 'agency';
const BATCH_SIZE = 50;
const POLL_MS = 500;
const LEASE_SECONDS = 30;
const MAX_ATTEMPTS = 10;
const RETENTION_DAYS = 7;
const METRICS_INTERVAL_MS = 10_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

@Injectable()
export class OperationsRoomOutboxWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OperationsRoomOutboxWorker.name);
  private readonly owner = `worker-${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopping = false;
  private lastMetricsAt = 0;
  private lastCleanupAt = 0;

  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(OperationsRoomOutboxEntity, AGENCY_CONNECTION)
    private readonly outboxRepository: Repository<OperationsRoomOutboxEntity>,
    private readonly bus: OperationsRoomEventBusService,
    private readonly metrics: OperationsRoomRealtimeMetrics,
  ) {}

  onApplicationBootstrap(): void {
    if (!operationsRoomRealtimeEnabled()) return;
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  isRunning(): boolean {
    return operationsRoomRealtimeEnabled() && !this.stopping;
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = this.tick().finally(() => {
        this.running = null;
        this.schedule(POLL_MS);
      });
    }, delay);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const rows = await this.claimBatch();
      for (const row of rows) {
        if (this.stopping) break;
        await this.publish(row);
      }
      const now = Date.now();
      if (now - this.lastMetricsAt >= METRICS_INTERVAL_MS) {
        this.lastMetricsAt = now;
        await this.refreshBacklogMetrics();
      }
      if (now - this.lastCleanupAt >= CLEANUP_INTERVAL_MS) {
        this.lastCleanupAt = now;
        await this.cleanupPublished();
      }
    } catch {
      this.logger.warn('Operations Room outbox tick failed; retrying.');
    }
  }

  private async claimBatch(): Promise<OperationsRoomOutboxEntity[]> {
    const rawResult: unknown = await this.dataSource.query(
      `
        WITH candidates AS (
          SELECT event_id
          FROM leadflow_operations_room_event_outbox
          WHERE dead_lettered_at IS NULL
            AND published_at IS NULL
            AND (
              (delivery_state = 'pending' AND next_attempt_at <= now())
              OR
              (delivery_state = 'processing' AND claimed_at < now() - ($2 * interval '1 second'))
            )
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $3
        )
        UPDATE leadflow_operations_room_event_outbox AS outbox
        SET delivery_state = 'processing',
            claim_owner = $1,
            claimed_at = now(),
            attempt_count = attempt_count + 1
        FROM candidates
        WHERE outbox.event_id = candidates.event_id
        RETURNING outbox.event_id
      `,
      [this.owner, LEASE_SECONDS, BATCH_SIZE],
    );
    // TypeORM/PostgreSQL returns [rows, affectedCount] for UPDATE RETURNING,
    // while test doubles and some driver versions return rows directly.
    const claimed = normalizeReturningRows(rawResult);
    if (!claimed.length) return [];
    const ids = claimed.map((row) => row.event_id);
    const rows = await this.outboxRepository.findBy({ eventId: In(ids) });
    const order = new Map(ids.map((id, index) => [id, index]));
    return rows.sort(
      (left, right) =>
        (order.get(left.eventId) ?? 0) - (order.get(right.eventId) ?? 0),
    );
  }

  private async publish(row: OperationsRoomOutboxEntity): Promise<void> {
    try {
      await this.bus.publish(mapOperationsRoomOutboxEvent(row));
      const publishedAt = new Date();
      await this.outboxRepository.update(
        {
          eventId: row.eventId,
          claimOwner: this.owner,
          deliveryState: RoomOutboxDeliveryState.Processing,
        },
        {
          deliveryState: RoomOutboxDeliveryState.Published,
          publishedAt,
          claimedAt: null,
          claimOwner: null,
          lastErrorCode: null,
        },
      );
      this.metrics.published(publishedAt.getTime() - row.createdAt.getTime());
    } catch (error) {
      const errorCode = sanitizedErrorCode(error);
      if (row.attemptCount >= MAX_ATTEMPTS) {
        await this.outboxRepository.update(
          { eventId: row.eventId, claimOwner: this.owner },
          {
            deliveryState: RoomOutboxDeliveryState.DeadLetter,
            deadLetteredAt: new Date(),
            lastErrorCode: errorCode,
            claimedAt: null,
            claimOwner: null,
          },
        );
        this.metrics.deadLettered();
        return;
      }
      const backoffMs = retryDelayMs(row.attemptCount);
      await this.outboxRepository.update(
        { eventId: row.eventId, claimOwner: this.owner },
        {
          deliveryState: RoomOutboxDeliveryState.Pending,
          nextAttemptAt: new Date(Date.now() + backoffMs),
          lastErrorCode: errorCode,
          claimedAt: null,
          claimOwner: null,
        },
      );
      this.metrics.retried();
    }
  }

  private async refreshBacklogMetrics(): Promise<void> {
    const [row] = await this.dataSource.query<
      Array<{ pending: number; oldest_age: number }>
    >(`
      SELECT count(*)::int AS pending,
             COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0)::float AS oldest_age
      FROM leadflow_operations_room_event_outbox
      WHERE published_at IS NULL AND dead_lettered_at IS NULL
    `);
    this.metrics.setBacklog(row?.pending ?? 0, row?.oldest_age ?? 0);
  }

  private async cleanupPublished(): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM leadflow_operations_room_event_outbox
       WHERE published_at < now() - ($1 * interval '1 day')`,
      [RETENTION_DAYS],
    );
  }
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(60_000, 500 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * Math.min(1_000, base / 4));
}

function sanitizedErrorCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error) {
    const rawCode = error.code;
    if (typeof rawCode === 'string' && /^[a-z0-9_.:-]{1,80}$/i.test(rawCode)) {
      return rawCode;
    }
  }
  return 'publish_failed';
}

function normalizeReturningRows(value: unknown): Array<{ event_id: string }> {
  if (!Array.isArray(value)) return [];
  const rows: unknown[] = Array.isArray(value[0]) ? value[0] : value;
  return rows.filter(
    (row): row is { event_id: string } =>
      typeof row === 'object' &&
      row !== null &&
      'event_id' in row &&
      typeof row.event_id === 'string',
  );
}
