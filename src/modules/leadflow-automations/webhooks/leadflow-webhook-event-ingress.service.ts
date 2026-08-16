import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';
import { getEventByName } from '../../leadflow-events/catalog/leadflow-event.catalog';
import { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { LeadFlowEventStatus } from '../../leadflow-events/enums/leadflow-event-status.enum';
import { LeadFlowWebhookDispatcherService } from './leadflow-webhook-dispatcher.service';
import { LeadFlowWebhookGate } from './leadflow-webhook-gate.service';

export const LEADFLOW_WEBHOOK_EVENT_CONSUMER = 'leadflow.webhooks' as const;

/**
 * The webhook module's own claim on the canonical event stream.
 *
 * It is a separate consumer rather than a branch inside the automations ingress
 * because the two fail differently: a customer endpoint that is down for an hour
 * must not slow down — or share a dead-letter budget with — the automations that
 * move opportunities and send messages. Its deliveries are independent rows,
 * claimed and retried on their own.
 *
 * Unlike the analytics consumer, this one does not check `consumedBy`: the
 * catalog's list names the platform's own subscribers, while a webhook's
 * audience is whatever an operator ticked. What it does honour is the contract —
 * an event that is not catalogued, not active, or of another version is skipped
 * rather than forwarded, so an endpoint never receives a shape the contract does
 * not describe.
 */
@Injectable()
export class LeadFlowWebhookEventIngressService implements OnApplicationShutdown {
  private readonly logger = new Logger(LeadFlowWebhookEventIngressService.name);
  private readonly workerId = `${hostname()}:${process.pid}:leadflow-webhooks`;
  private running = false;
  private stopping = false;
  private metrics = {
    claimed: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
  };

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly dispatcher: LeadFlowWebhookDispatcherService,
    private readonly gate: LeadFlowWebhookGate,
  ) {}

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  snapshot(): Readonly<typeof this.metrics> {
    return { ...this.metrics };
  }

  @Interval(5_000)
  async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    // With the switch off nothing is claimed at all: draining the stream into
    // "skipped" rows would quietly consume the events an operator expects to
    // see delivered the moment dispatch is turned on.
    if (!this.gate.isEnabled()) return;
    this.running = true;
    try {
      await this.processPending(25);
      this.metrics.retried += await this.dispatcher.retryDue(20);
    } catch (error) {
      this.logger.error(`Webhook event ingress failed: ${code(error)}`);
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
        [LEADFLOW_WEBHOOK_EVENT_CONSUMER, Math.max(1, limit)],
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
      consumerKey: LEADFLOW_WEBHOOK_EVENT_CONSUMER,
      status: 'processing',
      lockedBy: this.workerId,
    });
    if (!delivery) return;

    const now = new Date();
    const reason = this.reasonToSkip(delivery);
    if (reason) {
      await repository.update(
        { id: delivery.id, status: 'processing', lockedBy: this.workerId },
        {
          status: 'skipped',
          skippedAt: now,
          skipReason: reason,
          lockedAt: null,
          lockedBy: null,
          retainUntil: addDays(now, 30),
          updatedAt: now,
        },
      );
      this.metrics.skipped += 1;
      return;
    }

    try {
      // The event is marked delivered once it has been *handed to* the
      // endpoints: each webhook keeps its own row, its own retries and its own
      // dead-letter, so a customer's server being down is not this stream's
      // problem to carry.
      await this.dispatcher.dispatch(delivery);
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
              lastError: code(error),
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
              lastError: code(error),
              updatedAt: now,
            },
      );
      this.metrics.failed += 1;
    }
  }

  private reasonToSkip(delivery: LeadFlowEventDeliveryEntity): string | null {
    const event = getEventByName(delivery.eventName);
    if (!event) return 'event_not_catalogued';
    if (event.status !== LeadFlowEventStatus.Active) {
      return 'event_contract_not_active';
    }
    if (event.eventVersion !== delivery.eventVersion) {
      return 'event_version_not_supported';
    }
    return null;
  }
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function code(error: unknown): string {
  const value =
    error instanceof Error ? error.message : 'webhook_ingress_failed';
  return /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : 'webhook_ingress_failed';
}
