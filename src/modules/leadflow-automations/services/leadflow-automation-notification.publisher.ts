import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';

const AGENCY_CONNECTION = 'agency';

export interface AutomationNotificationInput {
  tenantId: string;
  workspaceId: string;
  /** Per-effect key; used as the notification source event id (dedup). */
  idempotencyKey: string;
  /** The CRM subject the alert is about, if any. */
  opportunityId: string | null;
  /** An explicitly configured recipient; wins over the subject's owner. */
  targetUserId: string | null;
  title: string;
  body: string;
  actionUrl: string;
}

export type AutomationNotificationOutcome =
  | { status: 'sent'; notificationId: string; recipientUserId: string }
  | { status: 'no_recipient' };

/**
 * Posts the in-app effect of the `notify_user` automation action.
 *
 * The owning domain of the effect is Notifications, so this delegates the whole
 * persistence/realtime/preference machinery to `NotificationEventProcessorService`
 * (idempotent by `eventId`). Its only extra job is recipient resolution: a
 * configured `targetUserRef` wins; otherwise the alert goes to the opportunity's
 * current owner. Reading the subject to know who is responsible mirrors how the
 * inbox handoff notification resolves its recipients — it is recipient routing,
 * not a cross-domain write.
 */
@Injectable()
export class LeadFlowAutomationNotificationPublisher {
  private readonly logger = new Logger(
    LeadFlowAutomationNotificationPublisher.name,
  );

  constructor(
    private readonly processor: NotificationEventProcessorService,
    @InjectRepository(CrmOpportunityEntity, AGENCY_CONNECTION)
    private readonly opportunities: Repository<CrmOpportunityEntity>,
  ) {}

  async publish(
    input: AutomationNotificationInput,
  ): Promise<AutomationNotificationOutcome> {
    const recipientUserId = await this.resolveRecipient(input);
    if (!recipientUserId) {
      return { status: 'no_recipient' };
    }

    const result = await this.processor.process({
      eventId: input.idempotencyKey,
      eventType: 'leadflow.automation.notify',
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      productKey: NotificationProductKey.AGENCY,
      moduleKey: 'sales',
      actorType: NotificationActorType.SYSTEM,
      actorUserId: null,
      resourceType: input.opportunityId ? 'crm_opportunity' : null,
      resourceId: input.opportunityId,
      occurredAt: new Date().toISOString(),
      recipients: [
        {
          userId: recipientUserId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      payload: {
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        opportunityId: input.opportunityId,
      },
    });

    // A recipient was resolved, so a skip here means the catalog/self-policy
    // dropped it — treat it as no eligible recipient rather than a phantom send.
    if (result.status === 'skipped' || !result.notificationId) {
      return { status: 'no_recipient' };
    }

    // `created` and `duplicate` are both confirmed: the notification for this
    // effect key exists exactly once, which is the idempotent outcome we want.
    return {
      status: 'sent',
      notificationId: result.notificationId,
      recipientUserId,
    };
  }

  private async resolveRecipient(
    input: AutomationNotificationInput,
  ): Promise<string | null> {
    if (input.targetUserId) {
      return input.targetUserId;
    }
    if (!input.opportunityId) {
      return null;
    }
    const opportunity = await this.opportunities.findOne({
      where: {
        id: input.opportunityId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      },
      select: { id: true, assignedUserId: true },
    });
    return opportunity?.assignedUserId ?? null;
  }
}
