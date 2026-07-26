import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { InboxSettingsEntity } from '../../inbox/entities/inbox-settings.entity';
import { evaluateBusinessHours } from './leadflow-automation-context-loader.service';

const AGENCY_CONNECTION = 'agency';
const HANDOFF_EVENT = 'leadflow.inbox.conversation.handoff.requested';
const CLOSED_EVENT = 'leadflow.inbox.business_hours.closed';

/**
 * Derives the outside-hours signal only from a canonical handoff request.
 *
 * It reads the same InboxSettings.businessHours used by the rest of LeadFlow,
 * refuses to guess when the configuration is missing, and writes a canonical
 * outbox event. The source handoff id is part of the unique key, so retries
 * cannot create a second outside-hours cycle.
 */
@Injectable()
export class LeadFlowBusinessHoursClosedDetectorService {
  constructor(
    @InjectRepository(InboxSettingsEntity, AGENCY_CONNECTION)
    private readonly settings: Repository<InboxSettingsEntity>,
    @InjectRepository(InboxDomainOutboxEntity, AGENCY_CONNECTION)
    private readonly outbox: Repository<InboxDomainOutboxEntity>,
  ) {}

  async observeDelivery(delivery: LeadFlowEventDeliveryEntity): Promise<void> {
    if (
      delivery.eventName !== HANDOFF_EVENT ||
      delivery.aggregateType !== 'inbox_conversation'
    ) {
      return;
    }

    const settings = await this.settings.findOne({
      where: {
        tenantId: delivery.tenantId,
        workspaceId: delivery.workspaceId,
      },
      select: { id: true, businessHours: true },
    });
    const evaluatedAt = new Date();
    const inside = evaluateBusinessHours(
      settings?.businessHours ?? null,
      evaluatedAt,
    );
    if (inside !== false) {
      return;
    }

    const businessHours = settings?.businessHours ?? {};
    const timezone =
      typeof businessHours.timezone === 'string'
        ? businessHours.timezone
        : 'UTC';
    const idempotencyKey = `business-hours-closed:${delivery.sourceEventId}`;

    await this.outbox
      .createQueryBuilder()
      .insert()
      .values({
        tenantId: delivery.tenantId,
        workspaceId: delivery.workspaceId,
        aggregateType: 'inbox_conversation',
        aggregateId: delivery.aggregateId,
        eventName: CLOSED_EVENT,
        eventVersion: 1,
        idempotencyKey,
        payload: {
          conversationId: delivery.aggregateId,
          handoffEventId: delivery.sourceEventId,
          handoffCycle:
            typeof delivery.payload.ownershipVersion === 'number'
              ? delivery.payload.ownershipVersion
              : 'unknown',
          timezone,
          evaluatedAt: evaluatedAt.toISOString(),
        },
        publishedAt: null,
      })
      .orIgnore()
      .execute();
  }
}
