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
    skipped: 0,
    pruned: 0,
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
    if (!this.config.outboxRelayEnabled || this.running || this.stopping)
      return;
    this.running = true;
    try {
      await this.processPending(10);
      this.metrics.pruned += await this.pruneExpired(100);
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
      if (!this.config.realtimeGatewayEnabled) {
        const skippedAt = new Date();
        await repo.update(
          { id: row.id, status: 'processing', lockedBy: this.workerId },
          {
            status: 'skipped',
            skippedAt,
            skipReason: 'realtime_disabled',
            retainUntil: addDays(skippedAt, 30),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            updatedAt: skippedAt,
          },
        );
        this.metrics.skipped += 1;
        return;
      }
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
          retainUntil: addDays(publishedAt, 30),
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
              retainUntil: addDays(now, 90),
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

  async inspect(
    tenantId: string,
    workspaceId: string,
    input: { status?: string; eventName?: string; limit?: number } = {},
  ) {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const params: Array<string | number> = [tenantId, workspaceId];
    const where = ['tenant_id = $1', 'workspace_id = $2'];
    if (input.status) {
      params.push(input.status);
      where.push(`status = $${params.length}`);
    }
    if (input.eventName) {
      params.push(input.eventName);
      where.push(`event_name = $${params.length}`);
    }
    params.push(limit);
    const items = await this.dataSource.query<
      Array<{
        id: string;
        aggregateType: string;
        aggregateId: string;
        eventName: string;
        status: string;
        deliveryKind: string;
        attempts: number;
        availableAt: Date;
        createdAt: Date;
        publishedAt: Date | null;
        skippedAt: Date | null;
        skipReason: string | null;
        deadLetteredAt: Date | null;
        retainUntil: Date | null;
      }>
    >(
      `SELECT id, aggregate_type AS "aggregateType", aggregate_id AS "aggregateId",
              event_name AS "eventName", status, delivery_kind AS "deliveryKind",
              attempts, available_at AS "availableAt", created_at AS "createdAt",
              published_at AS "publishedAt", skipped_at AS "skippedAt",
              skip_reason AS "skipReason", dead_lettered_at AS "deadLetteredAt",
              retain_until AS "retainUntil"
         FROM inbox_domain_outbox
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    const summary = await this.dataSource.query<
      Array<{
        status: string;
        count: number;
        oldestAt: Date;
        newestAt: Date;
        maxAttempts: number;
      }>
    >(
      `SELECT status, count(*)::int AS count,
              min(created_at) AS "oldestAt", max(created_at) AS "newestAt",
              max(attempts)::int AS "maxAttempts"
         FROM inbox_domain_outbox
        WHERE tenant_id = $1 AND workspace_id = $2
        GROUP BY status ORDER BY status`,
      [tenantId, workspaceId],
    );
    return { summary, items };
  }

  async reprocess(
    tenantId: string,
    workspaceId: string,
    eventId: string,
    actorUserId?: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(InboxDomainOutboxEntity)
        .set({
          status: 'pending',
          attempts: 0,
          availableAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          skippedAt: null,
          skipReason: null,
          deadLetteredAt: null,
          retainUntil: null,
          updatedAt: new Date(),
        })
        .where(
          'id = :eventId AND tenant_id = :tenantId AND workspace_id = :workspaceId',
          { eventId, tenantId, workspaceId },
        )
        .andWhere("status IN ('skipped', 'dead_letter')")
        .execute();
      if (result.affected === 1) {
        await manager.query(
          `INSERT INTO platform_permission_audit_events
            (tenant_id, workspace_id, actor_user_id, action, resource_type,
             resource_id, risk_level, metadata)
           VALUES ($1, $2, $3, 'inbox.outbox.reprocessed', 'inbox_outbox',
                   $4, 'high', '{"outcome":"queued"}'::jsonb)`,
          [tenantId, workspaceId, actorUserId ?? null, eventId],
        );
      }
      return { reprocessed: result.affected === 1 };
    });
  }

  async pruneExpired(limit = 100) {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM inbox_domain_outbox
        WHERE status IN ('published', 'skipped', 'dead_letter')
          AND retain_until IS NOT NULL AND retain_until < now()
        ORDER BY retain_until, id LIMIT $1`,
      [limit],
    );
    if (rows.length === 0) return 0;
    const result = await this.dataSource
      .createQueryBuilder()
      .delete()
      .from(InboxDomainOutboxEntity)
      .whereInIds(rows.map((row) => row.id))
      .execute();
    return result.affected ?? 0;
  }
}
function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}
function code(error: unknown): string {
  const value =
    error instanceof Error ? error.message : 'outbox_publish_failed';
  return /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : 'outbox_publish_failed';
}
