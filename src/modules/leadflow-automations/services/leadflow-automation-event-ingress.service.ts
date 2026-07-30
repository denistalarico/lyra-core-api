import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';
import {
  LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS,
  getEventByName,
} from '../../leadflow-events/catalog/leadflow-event.catalog';
import { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { LeadFlowEventStatus } from '../../leadflow-events/enums/leadflow-event-status.enum';
import { LeadFlowAutomationShadowEvaluatorService } from './leadflow-automation-shadow-evaluator.service';
import { LeadFlowFollowupIdleDetectorService } from './leadflow-followup-idle-detector.service';
import { LeadFlowBusinessHoursClosedDetectorService } from './leadflow-business-hours-closed-detector.service';
import { LeadFlowAppointmentLifecycleSchedulerService } from './leadflow-appointment-lifecycle-scheduler.service';

export const LEADFLOW_AUTOMATIONS_EVENT_CONSUMER =
  'leadflow.automations' as const;

type IngressDecision =
  | { status: 'delivered' }
  | { status: 'skipped'; reason: string };

/**
 * Durable ingress boundary between canonical domain events and Automations.
 *
 * Phase 10 acknowledges a delivery only after every matching published
 * automation has a durable shadow run. The evaluation never asks an executor
 * for an effect; it only records what the published configuration would do.
 */
@Injectable()
export class LeadFlowAutomationEventIngressService implements OnApplicationShutdown {
  private readonly logger = new Logger(
    LeadFlowAutomationEventIngressService.name,
  );
  private readonly workerId = `${hostname()}:${process.pid}:leadflow-automations-events`;
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
    shadowEvaluated: 0,
  };

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly shadowEvaluator: LeadFlowAutomationShadowEvaluatorService,
    @Optional()
    private readonly idleDetector?: LeadFlowFollowupIdleDetectorService,
    @Optional()
    private readonly businessHoursDetector?: LeadFlowBusinessHoursClosedDetectorService,
    @Optional()
    private readonly appointmentLifecycleScheduler?: LeadFlowAppointmentLifecycleSchedulerService,
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
      this.logger.error(`LeadFlow event ingress failed: ${errorCode(error)}`);
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
        [LEADFLOW_AUTOMATIONS_EVENT_CONSUMER, Math.max(1, limit)],
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
      consumerKey: LEADFLOW_AUTOMATIONS_EVENT_CONSUMER,
      status: 'processing',
      lockedBy: this.workerId,
    });
    if (!delivery) return;

    try {
      // Derived idle detection observes message.sent even though that event is
      // not itself an automation trigger. Scheduling is idempotent, so a retry
      // of this delivery never creates a second detector timer.
      await this.idleDetector?.observeDelivery(delivery);
      await this.businessHoursDetector?.observeDelivery(delivery);
      await this.appointmentLifecycleScheduler?.observeDelivery(delivery);
      const decision = this.accept(delivery);
      const now = new Date();
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

      // Persist every matching verdict before acknowledging the delivery. If
      // anything fails, the delivery returns to pending; replay is safe because
      // one shadow run is idempotent on event + automation and pins its version.
      const summaries = await this.shadowEvaluator.evaluateDelivery(delivery);

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
      this.metrics.shadowEvaluated += summaries.length;
    } catch (error) {
      const now = new Date();
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

    const hasMappedTrigger = LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS.some(
      (mapping) =>
        mapping.status === 'mapped' && mapping.eventName === delivery.eventName,
    );
    return hasMappedTrigger
      ? { status: 'delivered' }
      : { status: 'skipped', reason: 'event_not_mapped_to_automation' };
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
      [LEADFLOW_AUTOMATIONS_EVENT_CONSUMER, Math.max(1, limit)],
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
  const value = error instanceof Error ? error.message : 'event_ingress_failed';
  return /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : 'event_ingress_failed';
}
