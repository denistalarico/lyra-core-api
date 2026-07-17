import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'os';
import { DataSource } from 'typeorm';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxRealtimeEventBusService } from '../realtime/inbox-realtime-event-bus.service';
import { InboxRuntimeConfigService } from '../runtime/inbox-runtime-config.service';

export interface InboxOutboxPublisher {
  publish(eventId: string): Promise<void>;
}

@Injectable()
export class InboxOutboxRelayService
  implements OnApplicationShutdown, InboxOutboxPublisher
{
  private readonly logger = new Logger(InboxOutboxRelayService.name);
  private readonly workerId = `${hostname()}:${process.pid}:outbox`;
  private running = false;
  private stopping = false;
  private metrics = {
    claimed: 0,
    published: 0,
    failed: 0,
    deadLettered: 0,
    lastLagMs: 0,
  };

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly bus: InboxRealtimeEventBusService,
    private readonly config: InboxRuntimeConfigService,
  ) {}
  onApplicationShutdown(): void {
    this.stopping = true;
  }
  snapshot() {
    return { ...this.metrics };
  }
  async publish(eventId: string): Promise<void> {
    await this.bus.notify(eventId);
  }

  @Interval(1_000)
  async tick(): Promise<void> {
    if (!this.config.realtimeEnabled || this.running || this.stopping) return;
    this.running = true;
    try {
      await this.processPending(10);
    } catch (error) {
      this.logger.error(`Inbox outbox relay failed: ${code(error)}`);
    } finally {
      this.running = false;
    }
  }

  async processPending(limit = 10): Promise<number> {
    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM inbox_domain_outbox
         WHERE ((status = 'pending' AND available_at <= now()) OR (status = 'processing' AND locked_at < now() - interval '1 minute'))
         ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      if (rows.length)
        await manager
          .createQueryBuilder()
          .update(InboxDomainOutboxEntity)
          .set({
            status: 'processing',
            lockedAt: new Date(),
            lockedBy: this.workerId,
            attempts: () => 'attempts + 1',
            updatedAt: new Date(),
          })
          .whereInIds(rows.map((row) => row.id))
          .execute();
      return rows.map((row) => row.id);
    });
    this.metrics.claimed += ids.length;
    for (const id of ids) await this.processOne(id);
    return ids.length;
  }

  private async processOne(id: string): Promise<void> {
    const repo = this.dataSource.getRepository(InboxDomainOutboxEntity);
    const row = await repo.findOneBy({
      id,
      status: 'processing',
      lockedBy: this.workerId,
    });
    if (!row) return;
    try {
      await this.publish(row.id);
      const publishedAt = new Date();
      await repo.update(
        { id: row.id, status: 'processing', lockedBy: this.workerId },
        {
          status: 'published',
          publishedAt,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          updatedAt: publishedAt,
        },
      );
      this.metrics.published += 1;
      this.metrics.lastLagMs = Math.max(
        0,
        publishedAt.getTime() - row.createdAt.getTime(),
      );
    } catch (error) {
      const dead = row.attempts >= 8;
      const now = new Date();
      await repo.update(
        { id: row.id, status: 'processing', lockedBy: this.workerId },
        dead
          ? {
              status: 'dead_letter',
              deadLetteredAt: now,
              lockedAt: null,
              lockedBy: null,
              lastError: code(error),
              updatedAt: now,
            }
          : {
              status: 'pending',
              availableAt: new Date(
                Date.now() +
                  Math.min(60_000, 1_000 * 2 ** Math.max(0, row.attempts - 1)),
              ),
              lockedAt: null,
              lockedBy: null,
              lastError: code(error),
              updatedAt: now,
            },
      );
      this.metrics.failed += 1;
      if (dead) this.metrics.deadLettered += 1;
    }
  }
}
function code(error: unknown): string {
  const value =
    error instanceof Error ? error.message : 'outbox_publish_failed';
  return /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : 'outbox_publish_failed';
}
