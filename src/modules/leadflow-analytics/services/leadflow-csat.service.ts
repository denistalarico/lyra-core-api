import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../../inbox/entities/inbox-message.entity';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { LeadFlowCsatResponseEntity } from '../entities';

export interface StartCsatCycleInput {
  tenantId: string;
  workspaceId: string;
  automationId: string;
  idempotencyKey: string;
  requestSourceEventId: string;
  requestMessageId: string;
  requestedAt: Date;
  expiresAt: Date;
  contactId: string | null;
  conversationId: string;
  opportunityId: string | null;
  appointmentId?: string | null;
}

/**
 * Canonical write path for the minimal CSAT model introduced in Phase 7A.
 *
 * It owns the three state transitions (`pending`, `responded`, `expired`) and
 * emits the response event in the same transaction that records a score. A
 * missing answer is represented only by pending/expired, never by score zero.
 */
@Injectable()
export class LeadFlowCsatService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async startCycle(
    input: StartCsatCycleInput,
  ): Promise<LeadFlowCsatResponseEntity> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [
          `leadflow-csat:${input.tenantId}:${input.workspaceId}:${input.idempotencyKey}`,
        ],
      );
      const responses = manager.getRepository(LeadFlowCsatResponseEntity);
      const existing = await responses.findOne({
        where: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      if (existing) return existing;

      return responses.save(
        responses.create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          automationId: input.automationId,
          automationRunId: null,
          contactId: input.contactId,
          conversationId: input.conversationId,
          opportunityId: input.opportunityId,
          appointmentId: input.appointmentId ?? null,
          status: 'pending',
          score: null,
          idempotencyKey: input.idempotencyKey.slice(0, 180),
          requestSourceEventId: input.requestSourceEventId,
          responseSourceEventId: null,
          responseMessageId: null,
          requestedAt: input.requestedAt,
          respondedAt: null,
          expiresAt: input.expiresAt,
        }),
      );
    });
  }

  async observeInboundDelivery(
    delivery: LeadFlowEventDeliveryEntity,
  ): Promise<LeadFlowCsatResponseEntity | null> {
    if (
      delivery.eventName !== 'leadflow.inbox.conversation.message.received' ||
      delivery.aggregateType !== 'inbox_conversation'
    ) {
      return null;
    }
    const messageId = stringField(delivery.payload?.messageId);
    if (!messageId) return null;

    const message = await this.dataSource
      .getRepository(InboxMessageEntity)
      .findOne({
        where: {
          id: messageId,
          tenantId: delivery.tenantId,
          workspaceId: delivery.workspaceId,
          conversationId: delivery.aggregateId,
          direction: 'inbound',
        },
      });
    if (!message) return null;
    const score = parseCsatScore(message.content);
    if (score === null) return null;

    return this.dataSource.transaction(async (manager) => {
      const responses = manager.getRepository(LeadFlowCsatResponseEntity);
      const pending = await responses.findOne({
        where: {
          tenantId: delivery.tenantId,
          workspaceId: delivery.workspaceId,
          conversationId: delivery.aggregateId,
          status: 'pending',
          requestedAt: LessThanOrEqual(message.occurredAt),
        },
        order: { requestedAt: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !pending ||
        (pending.expiresAt &&
          pending.expiresAt.getTime() < message.occurredAt.getTime())
      ) {
        return null;
      }

      pending.status = 'responded';
      pending.score = score;
      pending.respondedAt = message.occurredAt;
      pending.responseSourceEventId = delivery.sourceEventId;
      pending.responseMessageId = message.id;
      const saved = await responses.save(pending);

      const outbox = manager.getRepository(InboxDomainOutboxEntity);
      await outbox
        .createQueryBuilder()
        .insert()
        .values(
          outbox.create({
            tenantId: delivery.tenantId,
            workspaceId: delivery.workspaceId,
            aggregateType: 'leadflow_csat_response',
            aggregateId: saved.id,
            eventName: 'leadflow.automations.csat.response.recorded',
            eventVersion: 1,
            idempotencyKey: `csat.response.recorded:${saved.id}`,
            payload: {
              automationId: saved.automationId,
              csatResponseId: saved.id,
              conversationId: saved.conversationId,
              contactId: saved.contactId,
              opportunityId: saved.opportunityId,
              appointmentId: saved.appointmentId,
              score,
              requestedAt: saved.requestedAt.toISOString(),
              respondedAt: message.occurredAt.toISOString(),
              channel: stringField(message.metadata?.channelType),
            },
            publishedAt: null,
          }) as never,
        )
        .orIgnore()
        .execute();
      return saved;
    });
  }

  async expire(
    tenantId: string,
    workspaceId: string,
    responseId: string,
    expiredAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(LeadFlowCsatResponseEntity)
      .set({ status: 'expired', updatedAt: expiredAt })
      .where('id = :responseId', { responseId })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere('workspace_id = :workspaceId', { workspaceId })
      .andWhere("status = 'pending'")
      .andWhere('(expires_at IS NULL OR expires_at <= :expiredAt)', {
        expiredAt,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}

export function parseCsatScore(value: string): number | null {
  const normalized = value.trim();
  return /^[1-5]$/.test(normalized) ? Number(normalized) : null;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
