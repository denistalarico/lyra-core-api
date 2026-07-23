import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { LeadFlowEventDeliveryEntity } from '../../../leadflow-events/entities';
import { CrmOpportunityEntity } from '../../entities/crm-opportunity.entity';
import { LeadScoreEngineService } from './lead-score-engine.service';

/** This consumer's own key in the shared delivery table. */
export const LEAD_SCORE_EVENT_CONSUMER = 'leadflow.crm.lead_score' as const;

/**
 * Inbox events that change a feature an active scoring rule reads.
 *
 * Only inbound messages do today: they move the engagement rules. Every other
 * inbox event the fan-out delivers here — outbound messages, handoff, assign,
 * close — leaves the active rules unchanged, so recalculating on them would
 * write identical snapshots for no reason.
 *
 * The CRM's own events are handled in-process and never reach this consumer;
 * the score's own events are `leadflow.crm.%` and are excluded at the trigger.
 * Together that makes a recalculation loop impossible.
 */
const RECALCULATION_EVENTS = new Set<string>([
  'leadflow.inbox.conversation.message.received',
]);

type IngressDecision =
  | { status: 'recalculate'; conversationId: string }
  | { status: 'skipped'; reason: string };

/**
 * Durable consumer that keeps a lead score current as the conversation moves.
 *
 * The gap this closes: engagement rules depend on inbox messages, which the CRM
 * command path never sees. This consumer receives inbound-message events through
 * the same durable fan-out the Automations ingress uses — its own consumer key,
 * its own deliveries, never touching another consumer's rows — resolves the
 * opportunity linked to the conversation, and asks the engine to recalculate.
 *
 * It owns no scoring logic. It decides *when* the CRM should recompute; the
 * engine still owns *what* the score is.
 */
@Injectable()
export class LeadScoreEventIngressService implements OnApplicationShutdown {
  private readonly logger = new Logger(LeadScoreEventIngressService.name);
  private readonly workerId = `${hostname()}:${process.pid}:leadflow-lead-score-events`;
  private running = false;
  private stopping = false;
  private metrics = {
    claimed: 0,
    recalculated: 0,
    skipped: 0,
    failed: 0,
    deadLettered: 0,
    pruned: 0,
  };

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly engine: LeadScoreEngineService,
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
      this.logger.error(`Lead score ingress failed: ${errorCode(error)}`);
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
        [LEAD_SCORE_EVENT_CONSUMER, Math.max(1, limit)],
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
      consumerKey: LEAD_SCORE_EVENT_CONSUMER,
      status: 'processing',
      lockedBy: this.workerId,
    });
    if (!delivery) return;

    const now = new Date();
    try {
      const decision = await this.handle(delivery);
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
      this.metrics.recalculated += 1;
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

  /**
   * Decides what a delivery means and, when it warrants one, performs the
   * recalculation. The recalculation carries the source event id, so a
   * redelivered message finds the snapshot it already produced and writes
   * nothing new.
   */
  private async handle(
    delivery: LeadFlowEventDeliveryEntity,
  ): Promise<IngressDecision> {
    if (!RECALCULATION_EVENTS.has(delivery.eventName)) {
      return { status: 'skipped', reason: 'event_not_scored' };
    }

    // Subject comes from the envelope, not the payload: the aggregate is the
    // conversation the Inbox itself named for this event.
    const conversationId =
      delivery.aggregateType === 'inbox_conversation'
        ? delivery.aggregateId
        : typeof delivery.payload?.conversationId === 'string'
          ? delivery.payload.conversationId
          : null;
    if (!conversationId) {
      return { status: 'skipped', reason: 'no_conversation_in_envelope' };
    }

    const ctx: RequestContext = {
      tenantId: delivery.tenantId,
      workspaceId: delivery.workspaceId,
    } as RequestContext;

    const opportunity = await this.dataSource
      .getRepository(CrmOpportunityEntity)
      .findOne({
        where: {
          tenantId: delivery.tenantId,
          workspaceId: delivery.workspaceId,
          inboxConversationId: conversationId,
        },
        select: { id: true },
      });
    if (!opportunity) {
      // A conversation with no opportunity is normal — not every chat becomes a
      // deal. There is nothing to score, and that is a clean skip, not a failure.
      return { status: 'skipped', reason: 'no_linked_opportunity' };
    }

    await this.engine.recalculate(ctx, {
      opportunityId: opportunity.id,
      reason: 'inbound_message',
      sourceEventId: delivery.sourceEventId,
      sourceEventName: delivery.eventName,
      correlationId:
        typeof delivery.payload?.correlationId === 'string'
          ? delivery.payload.correlationId
          : null,
    });

    return { status: 'recalculate', conversationId };
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
      [LEAD_SCORE_EVENT_CONSUMER, Math.max(1, limit)],
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
    error instanceof Error ? error.message : 'lead_score_ingress_failed';
  return /^[a-z0-9_.:-]{1,80}$/i.test(value)
    ? value
    : 'lead_score_ingress_failed';
}
