import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';
import { getEventByName } from '../../leadflow-events/catalog/leadflow-event.catalog';
import { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { LeadFlowEventStatus } from '../../leadflow-events/enums/leadflow-event-status.enum';
import { LeadFlowCsatService } from './leadflow-csat.service';

export const LEADFLOW_ANALYTICS_EVENT_CONSUMER = 'leadflow.analytics' as const;

type IngressDecision =
  | { status: 'delivered' }
  | { status: 'skipped'; reason: string };

/**
 * Phase 7A durable Analytics boundary.
 *
 * It intentionally projects nothing. Its only responsibility is to prove that
 * Analytics owns an independent delivery lifecycle and can safely keep up with
 * the canonical event stream before Phase 11 adds read models.
 */
@Injectable()
export class LeadFlowAnalyticsEventIngressService implements OnApplicationShutdown {
  private readonly logger = new Logger(
    LeadFlowAnalyticsEventIngressService.name,
  );
  private readonly workerId = `${hostname()}:${process.pid}:leadflow-analytics-events`;
  private running = false;
  private stopping = false;
  private metrics = {
    claimed: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
    deadLettered: 0,
    pruned: 0,
    lastLagMs: 0,
  };

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly csat: LeadFlowCsatService,
  ) {}

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  snapshot(): Readonly<typeof this.metrics> {
    return { ...this.metrics };
  }

  @Interval(1_000)
  async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      await this.processPending(25);
      this.metrics.pruned += await this.pruneExpired(100);
    } catch (error) {
      this.logger.error(`Analytics event ingress failed: ${errorCode(error)}`);
    } finally {
      this.running = false;
    }
  }

  async processPending(limit = 25): Promise<number> {
    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT id
           FROM leadflow_event_deliveries
          WHERE consumer_key = $1
            AND (
              (status = 'pending' AND available_at <= now())
              OR (status = 'processing' AND locked_at < now() - interval '1 minute')
            )
          ORDER BY occurred_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [LEADFLOW_ANALYTICS_EVENT_CONSUMER, Math.max(1, limit)],
      );
      if (rows.length > 0) {
        await manager
          .createQueryBuilder()
          .update(LeadFlowEventDeliveryEntity)
          .set({
            status: 'processing',
            lockedAt: new Date(),
            lockedBy: this.workerId,
            attempts: () => 'attempts + 1',
            updatedAt: new Date(),
          })
          .whereInIds(rows.map((row) => row.id))
          .execute();
      }
      return rows.map((row) => row.id);
    });

    this.metrics.claimed += ids.length;
    for (const id of ids) await this.processOne(id);
    return ids.length;
  }

  private async processOne(id: string): Promise<void> {
    const repository = this.dataSource.getRepository(
      LeadFlowEventDeliveryEntity,
    );
    const delivery = await repository.findOneBy({
      id,
      consumerKey: LEADFLOW_ANALYTICS_EVENT_CONSUMER,
      status: 'processing',
      lockedBy: this.workerId,
    });
    if (!delivery) return;

    const now = new Date();
    try {
      const decision = this.accept(delivery);
      if (decision.status === 'skipped') {
        await repository.update(
          { id: delivery.id, status: 'processing', lockedBy: this.workerId },
          {
            status: 'skipped',
            skippedAt: now,
            skipReason: decision.reason,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            retainUntil: addDays(now, 30),
            updatedAt: now,
          },
        );
        this.metrics.skipped += 1;
        return;
      }

      // A stateful projection may only observe an event after the catalog,
      // version and consumer-ownership checks accept its contract.
      await this.csat.observeInboundDelivery(delivery);

      await repository.update(
        { id: delivery.id, status: 'processing', lockedBy: this.workerId },
        {
          status: 'delivered',
          deliveredAt: now,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          retainUntil: addDays(now, 30),
          updatedAt: now,
        },
      );
      this.metrics.delivered += 1;
      this.metrics.lastLagMs = Math.max(
        0,
        now.getTime() - delivery.occurredAt.getTime(),
      );
    } catch (error) {
      const dead = delivery.attempts >= 8;
      await repository.update(
        { id: delivery.id, status: 'processing', lockedBy: this.workerId },
        dead
          ? {
              status: 'dead_letter',
              deadLetteredAt: now,
              lockedAt: null,
              lockedBy: null,
              lastError: errorCode(error),
              retainUntil: addDays(now, 90),
              updatedAt: now,
            }
          : {
              status: 'pending',
              availableAt: new Date(
                Date.now() +
                  Math.min(
                    60_000,
                    1_000 * 2 ** Math.max(0, delivery.attempts - 1),
                  ),
              ),
              lockedAt: null,
              lockedBy: null,
              lastError: errorCode(error),
              updatedAt: now,
            },
      );
      this.metrics.failed += 1;
      if (dead) this.metrics.deadLettered += 1;
    }
  }

  private accept(delivery: LeadFlowEventDeliveryEntity): IngressDecision {
    const event = getEventByName(delivery.eventName);
    if (!event) return { status: 'skipped', reason: 'event_not_catalogued' };
    if (event.status !== LeadFlowEventStatus.Active) {
      return { status: 'skipped', reason: 'event_contract_not_active' };
    }
    if (event.eventVersion !== delivery.eventVersion) {
      return { status: 'skipped', reason: 'event_version_not_supported' };
    }
    if (!event.consumedBy.includes(LEADFLOW_ANALYTICS_EVENT_CONSUMER)) {
      return { status: 'skipped', reason: 'event_not_owned_by_analytics' };
    }
    return { status: 'delivered' };
  }

  async pruneExpired(limit = 100): Promise<number> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT id
         FROM leadflow_event_deliveries
        WHERE consumer_key = $1
          AND status IN ('delivered', 'skipped', 'dead_letter')
          AND retain_until IS NOT NULL
          AND retain_until < now()
        ORDER BY retain_until, id
        LIMIT $2`,
      [LEADFLOW_ANALYTICS_EVENT_CONSUMER, Math.max(1, limit)],
    );
    if (rows.length === 0) return 0;
    const result = await this.dataSource
      .createQueryBuilder()
      .delete()
      .from(LeadFlowEventDeliveryEntity)
      .whereInIds(rows.map((row) => row.id))
      .execute();
    return result.affected ?? 0;
  }
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function errorCode(error: unknown): string {
  const value =
    error instanceof Error ? error.message : 'analytics_ingress_failed';
  return /^[a-z0-9_.:-]{1,80}$/i.test(value)
    ? value
    : 'analytics_ingress_failed';
}
