import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../notifications/enums';
import { NotificationEventProcessorService } from '../notifications/services';
import { NotificationExplicitRecipient } from '../notifications/types';
import { CrmOpportunityEntity } from './entities/crm-opportunity.entity';
import { CrmOpportunityEventEntity } from './entities/crm-opportunity-event.entity';
import { QuoteEntity, QuoteStatusHistoryEntity } from '../quotes/entities/quote.entities';

type SalesRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

type SalesResourceInput<TResource> = {
  resource: TResource;
  actorType?: NotificationActorType;
  actorUserId?: string | null;
  initiatedByUserId?: string | null;
  occurredAt?: Date;
  recipients?: SalesRecipientInput[];
  eventIdSuffix?: string | null;
};

@Injectable()
export class SalesNotificationPublisher {
  private readonly logger = new Logger(SalesNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishLeadAssigned(
    input: SalesResourceInput<CrmOpportunityEntity> & {
      assignedUserId?: string | null;
    },
  ) {
    return this.publishSalesEvent({
      ...input,
      eventType: 'sales.lead_assigned',
      eventIdParts: [
        'sales.lead_assigned',
        input.resource.id,
        input.assignedUserId,
        this.timestampFor(input.occurredAt ?? input.resource.updatedAt),
      ],
      resourceType: 'crm_opportunity',
      resourceId: input.resource.id,
      title: 'Lead atribuído',
      body: `O lead "${input.resource.title}" foi atribuído a você.`,
      actionUrl: '/sales',
      recipients:
        input.recipients ??
        [
          {
            userId: input.assignedUserId,
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
      payload: {
        opportunityId: input.resource.id,
      },
    });
  }

  publishOpportunityAssigned(
    input: SalesResourceInput<CrmOpportunityEntity> & {
      assignedUserId?: string | null;
    },
  ) {
    return this.publishSalesEvent({
      ...input,
      eventType: 'sales.opportunity_assigned',
      eventIdParts: [
        'sales.opportunity_assigned',
        input.resource.id,
        input.assignedUserId,
        this.timestampFor(input.occurredAt ?? input.resource.updatedAt),
      ],
      resourceType: 'crm_opportunity',
      resourceId: input.resource.id,
      title: 'Oportunidade atribuída',
      body: `A oportunidade "${input.resource.title}" foi atribuída a você.`,
      actionUrl: '/sales',
      recipients:
        input.recipients ??
        [
          {
            userId: input.assignedUserId,
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
      payload: {
        opportunityId: input.resource.id,
      },
    });
  }

  publishOpportunityStageChanged(
    input: SalesResourceInput<CrmOpportunityEntity> & {
      event?: CrmOpportunityEventEntity | null;
      previousStageId?: string | null;
      stageId?: string | null;
    },
  ) {
    return this.publishSalesEvent({
      ...input,
      eventType: 'sales.stage_changed',
      eventIdParts: [
        'sales.stage_changed',
        input.resource.id,
        input.previousStageId,
        input.stageId ?? input.resource.stageId,
        input.event?.id,
        this.timestampFor(input.event?.createdAt ?? input.resource.updatedAt),
      ],
      resourceType: 'crm_opportunity',
      resourceId: input.resource.id,
      title: 'Etapa da oportunidade alterada',
      body: `A oportunidade "${input.resource.title}" mudou de etapa.`,
      actionUrl: '/sales',
      recipients:
        input.recipients ??
        [
          {
            userId: input.resource.assignedUserId,
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
      payload: {
        opportunityId: input.resource.id,
        previousStageId: input.previousStageId ?? null,
        stageId: input.stageId ?? input.resource.stageId,
        opportunityEventId: input.event?.id ?? null,
      },
    });
  }

  publishQuoteSent(
    input: SalesResourceInput<QuoteEntity> & {
      statusHistory?: QuoteStatusHistoryEntity | null;
    },
  ) {
    return this.publishQuoteEvent(input, {
      eventType: 'sales.quote_sent',
      title: 'Cotação enviada',
      body: `A cotação ${input.resource.quoteNumber} foi marcada como enviada.`,
      statusHistory: input.statusHistory,
    });
  }

  publishQuoteViewed(input: SalesResourceInput<QuoteEntity>) {
    return this.publishQuoteEvent(input, {
      eventType: 'sales.quote_viewed',
      title: 'Cotação visualizada',
      body: `A cotação ${input.resource.quoteNumber} foi visualizada.`,
    });
  }

  publishQuoteAccepted(
    input: SalesResourceInput<QuoteEntity> & {
      statusHistory?: QuoteStatusHistoryEntity | null;
    },
  ) {
    return this.publishQuoteEvent(input, {
      eventType: 'sales.quote_accepted',
      title: 'Cotação aceita',
      body: `A cotação ${input.resource.quoteNumber} foi aceita.`,
      occurredAt: input.resource.acceptedAt ?? input.occurredAt,
      statusHistory: input.statusHistory,
    });
  }

  publishQuoteRejected(
    input: SalesResourceInput<QuoteEntity> & {
      statusHistory?: QuoteStatusHistoryEntity | null;
    },
  ) {
    return this.publishQuoteEvent(input, {
      eventType: 'sales.quote_rejected',
      title: 'Cotação recusada',
      body: `A cotação ${input.resource.quoteNumber} foi recusada.`,
      occurredAt: input.resource.rejectedAt ?? input.occurredAt,
      statusHistory: input.statusHistory,
    });
  }

  publishQuoteExpired(
    input: SalesResourceInput<QuoteEntity> & {
      statusHistory?: QuoteStatusHistoryEntity | null;
    },
  ) {
    return this.publishQuoteEvent(input, {
      eventType: 'sales.quote_expired',
      title: 'Cotação expirada',
      body: `A cotação ${input.resource.quoteNumber} foi marcada como expirada.`,
      statusHistory: input.statusHistory,
    });
  }

  publishFollowUpRequired(input: SalesResourceInput<CrmOpportunityEntity>) {
    return this.publishSalesEvent({
      ...input,
      eventType: 'sales.follow_up_required',
      eventIdParts: [
        'sales.follow_up_required',
        input.resource.id,
        this.timestampFor(input.resource.nextFollowUpAt),
        input.eventIdSuffix,
      ],
      resourceType: 'crm_opportunity',
      resourceId: input.resource.id,
      title: 'Follow-up necessário',
      body: `A oportunidade "${input.resource.title}" precisa de follow-up.`,
      actionUrl: '/sales',
      recipients:
        input.recipients ??
        [
          {
            userId: input.resource.assignedUserId,
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
      payload: {
        opportunityId: input.resource.id,
      },
    });
  }

  publishActivityCreated(input: SalesResourceInput<CrmOpportunityEntity>) {
    return this.publishPreparedOpportunityEvent(input, 'sales.activity_assigned');
  }

  publishActivityCompleted(input: SalesResourceInput<CrmOpportunityEntity>) {
    return this.publishPreparedOpportunityEvent(input, 'sales.activity_assigned');
  }

  publishOpportunityStale(input: SalesResourceInput<CrmOpportunityEntity>) {
    return this.publishPreparedOpportunityEvent(input, 'sales.opportunity_stale');
  }

  publishQuoteExpiring(input: SalesResourceInput<QuoteEntity>) {
    return this.publishQuoteEvent(input, {
      eventType: 'sales.quote_expiring',
      title: 'Cotação perto do vencimento',
      body: `A cotação ${input.resource.quoteNumber} está perto do vencimento.`,
    });
  }

  publishForecastChanged(input: SalesResourceInput<CrmOpportunityEntity>) {
    return this.publishPreparedOpportunityEvent(input, 'sales.forecast_changed');
  }

  publishRevenueTargetAtRisk(input: SalesResourceInput<CrmOpportunityEntity>) {
    return this.publishPreparedOpportunityEvent(
      input,
      'sales.revenue_target_at_risk',
    );
  }

  private publishPreparedOpportunityEvent(
    input: SalesResourceInput<CrmOpportunityEntity>,
    eventType: string,
  ) {
    return this.publishSalesEvent({
      ...input,
      eventType,
      eventIdParts: [eventType, input.resource.id, input.eventIdSuffix],
      resourceType: 'crm_opportunity',
      resourceId: input.resource.id,
      title: 'Alerta comercial',
      body: `A oportunidade "${input.resource.title}" requer atenção.`,
      actionUrl: '/sales',
      recipients: input.recipients ?? [],
      payload: {
        opportunityId: input.resource.id,
      },
    });
  }

  private publishQuoteEvent(
    input: SalesResourceInput<QuoteEntity>,
    options: {
      eventType: string;
      title: string;
      body: string;
      occurredAt?: Date | string | null;
      statusHistory?: QuoteStatusHistoryEntity | null;
    },
  ) {
    return this.publishSalesEvent({
      ...input,
      eventType: options.eventType,
      eventIdParts: [
        options.eventType,
        input.resource.id,
        options.statusHistory?.id,
        this.timestampFor(
          options.occurredAt ??
            options.statusHistory?.changedAt ??
            input.occurredAt ??
            input.resource.updatedAt,
        ),
      ],
      resourceType: 'sales_quote',
      resourceId: input.resource.id,
      title: options.title,
      body: options.body,
      actionUrl: `/sales/quotes/${input.resource.id}`,
      recipients:
        input.recipients ??
        [
          {
            userId: input.resource.createdByUserId,
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      payload: {
        quoteId: input.resource.id,
        quoteNumber: input.resource.quoteNumber,
        opportunityId: input.resource.opportunityId,
        statusHistoryId: options.statusHistory?.id ?? null,
      },
    });
  }

  private async publishSalesEvent<TResource extends {
    tenantId: string;
    workspaceId: string;
  }>(
    input: SalesResourceInput<TResource> & {
      eventType: string;
      eventIdParts: Array<string | null | undefined>;
      resourceType: string;
      resourceId: string | null;
      title: string;
      body: string;
      actionUrl: string | null;
      recipients: SalesRecipientInput[];
      payload?: Record<string, unknown>;
    },
  ) {
    const recipients = this.normalizeRecipients(
      input.recipients,
      input.actorUserId,
    );

    if (recipients.length === 0) {
      return;
    }

    try {
      await this.notificationEventProcessor.process({
        eventId: this.buildEventId(input.eventIdParts),
        eventType: input.eventType,
        tenantId: input.resource.tenantId,
        workspaceId: input.resource.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'sales',
        actorType: input.actorType ?? NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        initiatedByUserId: input.initiatedByUserId ?? null,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: input.actionUrl,
          resourceId: input.resourceId,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for sales resource ${input.resourceId} tenant ${input.resource.tenantId} workspace ${input.resource.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeRecipients(
    recipients: SalesRecipientInput[],
    actorUserId?: string | null,
  ): NotificationExplicitRecipient[] {
    const normalized = new Map<string, NotificationInterestReason>();

    for (const recipient of recipients) {
      const userId = recipient.userId?.trim();

      if (!userId || userId === actorUserId) {
        continue;
      }

      if (!normalized.has(userId)) {
        normalized.set(userId, recipient.interestReason);
      }
    }

    return Array.from(normalized.entries()).map(
      ([userId, interestReason]) => ({
        userId,
        interestReason,
      }),
    );
  }

  private buildEventId(parts: Array<string | null | undefined>) {
    return parts.map((part) => part ?? 'none').join(':');
  }

  private timestampFor(value?: Date | string | null) {
    if (!value) {
      return new Date().toISOString();
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
