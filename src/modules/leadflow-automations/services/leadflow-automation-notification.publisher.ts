import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AgencyUserNotificationPreferencesEntity,
  AgencyUserProfileEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from '../../agency/entities/agency-settings.entities';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmPipelineEntity } from '../../crm/entities/crm-pipeline.entity';
import {
  NotificationDeliveryEntity,
  NotificationRecipientEntity,
} from '../../notifications/entities';
import {
  NotificationActorType,
  NotificationDeliveryStatus,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import {
  LEADFLOW_HOT_LEAD_TEMPLATE_KEY,
  type HotLeadWhatsAppTemplateVariables,
} from '../../notifications/platform-whatsapp/platform-whatsapp-notification.catalog';
import { PlatformWhatsAppDeliveryService } from '../../notifications/platform-whatsapp/platform-whatsapp-delivery.service';
import { NotificationEventProcessorService } from '../../notifications/services';

const AGENCY_CONNECTION = 'agency';

export type HotLeadNotificationChannel =
  | 'in_app'
  | 'push'
  | 'platform_whatsapp'
  | 'email';

export type HotLeadDeliveryStatus =
  | 'sent'
  | 'failed'
  | 'skipped_duplicate'
  | 'skipped_recipient_unavailable'
  | 'skipped_preference_disabled'
  | 'skipped_channel_unavailable'
  | 'skipped_web_push_unavailable'
  | 'skipped_whatsapp_provider_disabled'
  | 'skipped_whatsapp_template_unavailable'
  | 'skipped_email_unavailable';

export interface HotLeadChannelResult {
  recipientUserId: string;
  channel: HotLeadNotificationChannel;
  status: HotLeadDeliveryStatus;
}

export interface AutomationNotificationInput {
  tenantId: string;
  workspaceId: string;
  idempotencyKey: string;
  opportunityId: string;
  targetUserId: string | null;
  notifyOpportunityOwner: boolean;
  notifyPipelineOwner: boolean;
  notifyPipelineParticipants: boolean;
  specificRecipientUserIds: string[];
  channels: HotLeadNotificationChannel[];
  cycleId: string;
  policyVersion: string;
  currentScore: number | null;
  title: string;
  body: string;
  actionUrl: string;
}

export type AutomationNotificationOutcome =
  | {
      status: 'processed';
      notificationId: string | null;
      recipientUserIds: string[];
      channelResults: HotLeadChannelResult[];
    }
  | { status: 'no_recipient'; channelResults: HotLeadChannelResult[] };

/**
 * Fan-out for the hot-lead automation. Recipient rules are resolved against
 * current CRM/workspace state, then each channel is attempted independently.
 * Notifications owns in-app/e-mail/Web Push; the platform provider owns
 * WhatsApp. No workspace commercial channel or credential is consulted.
 */
@Injectable()
export class LeadFlowAutomationNotificationPublisher {
  private readonly logger = new Logger(
    LeadFlowAutomationNotificationPublisher.name,
  );

  constructor(
    private readonly processor: NotificationEventProcessorService,
    private readonly whatsapp: PlatformWhatsAppDeliveryService,
    @InjectRepository(CrmOpportunityEntity, AGENCY_CONNECTION)
    private readonly opportunities: Repository<CrmOpportunityEntity>,
    @InjectRepository(CrmPipelineEntity, AGENCY_CONNECTION)
    private readonly pipelines: Repository<CrmPipelineEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsers: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyWorkspaceUserPermissionEntity, AGENCY_CONNECTION)
    private readonly workspacePermissions: Repository<AgencyWorkspaceUserPermissionEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profiles: Repository<AgencyUserProfileEntity>,
    @InjectRepository(
      AgencyUserNotificationPreferencesEntity,
      AGENCY_CONNECTION,
    )
    private readonly notificationPreferences: Repository<AgencyUserNotificationPreferencesEntity>,
    @InjectRepository(AgencyWorkspaceCompanySettingsEntity, AGENCY_CONNECTION)
    private readonly companies: Repository<AgencyWorkspaceCompanySettingsEntity>,
    @InjectRepository(NotificationRecipientEntity, AGENCY_CONNECTION)
    private readonly notificationRecipients: Repository<NotificationRecipientEntity>,
  ) {}

  async publish(
    input: AutomationNotificationInput,
  ): Promise<AutomationNotificationOutcome> {
    const opportunity = await this.opportunities.findOne({
      where: {
        id: input.opportunityId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      },
    });
    if (!opportunity) {
      return { status: 'no_recipient', channelResults: [] };
    }

    const recipientUserIds = await this.resolveRecipients(input, opportunity);
    if (recipientUserIds.length === 0) {
      return { status: 'no_recipient', channelResults: [] };
    }
    const company = await this.companies
      .findOne({
        where: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
        },
        select: {
          workspaceName: true,
          tradeName: true,
          legalName: true,
        },
      })
      .catch(() => null);
    const workspaceName =
      firstNonEmpty(
        company?.workspaceName,
        company?.tradeName,
        company?.legalName,
      ) ?? 'Seu workspace';
    const leadDisplayName =
      firstNonEmpty(
        opportunity.contactName,
        opportunity.title,
        maskPhone(opportunity.contactPhone),
      ) ?? 'Lead sem nome';
    const leadScore =
      typeof input.currentScore === 'number'
        ? String(Math.max(0, Math.min(100, Math.round(input.currentScore))))
        : 'Alto';

    const channelResults: HotLeadChannelResult[] = [];
    let notificationId: string | null = null;
    const notificationChannels = input.channels.filter(
      (channel): channel is 'in_app' | 'push' | 'email' =>
        channel !== 'platform_whatsapp',
    );

    if (notificationChannels.length > 0) {
      try {
        const processed = await this.processor.process({
          eventId: `${input.idempotencyKey}:notifications`,
          eventType: 'leadflow.hot_lead.detected',
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          productKey: NotificationProductKey.AGENCY,
          moduleKey: 'sales',
          actorType: NotificationActorType.SYSTEM,
          actorUserId: null,
          resourceType: 'crm_opportunity',
          resourceId: input.opportunityId,
          occurredAt: new Date().toISOString(),
          recipients: recipientUserIds.map((userId) => ({
            userId,
            interestReason: NotificationInterestReason.ASSIGNED,
          })),
          payload: {
            title: input.title,
            body: `${leadDisplayName} atingiu Lead Score ${leadScore} em ${workspaceName}.`,
            actionUrl: input.actionUrl,
            opportunityId: input.opportunityId,
            leadScore: input.currentScore,
            policyVersion: input.policyVersion,
            cycleId: input.cycleId,
            deliveryChannels: notificationChannels,
          },
        });
        if (processed.status !== 'skipped') {
          notificationId = processed.notificationId;
          channelResults.push(
            ...(await this.notificationChannelResults(
              notificationId,
              recipientUserIds,
              notificationChannels,
              processed.status === 'duplicate',
            )),
          );
        }
      } catch (error) {
        this.logger.warn(
          `Hot-lead Notifications fan-out failed: ${errorName(error)}`,
        );
        channelResults.push(
          ...crossResults(recipientUserIds, notificationChannels, 'failed'),
        );
      }
    }

    if (input.channels.includes('platform_whatsapp')) {
      channelResults.push(
        ...(await this.deliverWhatsApp(
          input,
          opportunity,
          recipientUserIds,
          workspaceName,
          leadDisplayName,
          leadScore,
        )),
      );
    }

    return {
      status: 'processed',
      notificationId,
      recipientUserIds,
      channelResults,
    };
  }

  private async resolveRecipients(
    input: AutomationNotificationInput,
    opportunity: CrmOpportunityEntity,
  ): Promise<string[]> {
    const candidates = new Set(input.specificRecipientUserIds);
    if (input.targetUserId) candidates.add(input.targetUserId);
    if (input.notifyOpportunityOwner && opportunity.assignedUserId) {
      candidates.add(opportunity.assignedUserId);
    }

    if (input.notifyPipelineOwner || input.notifyPipelineParticipants) {
      const pipeline = await this.pipelines.findOne({
        where: {
          id: opportunity.pipelineId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
        },
        select: {
          id: true,
          ownerUserId: true,
          allowedUserIds: true,
        },
      });
      if (input.notifyPipelineOwner && pipeline?.ownerUserId) {
        candidates.add(pipeline.ownerUserId);
      }
      if (input.notifyPipelineParticipants) {
        pipeline?.allowedUserIds.forEach((userId) => candidates.add(userId));
      }
    }
    if (candidates.size === 0) return [];

    const users = await this.workspaceUsers.find({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        userId: In([...candidates]),
        status: 'active',
      },
      select: { id: true, userId: true },
    });
    const blocked = await this.workspacePermissions.find({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        workspaceUserId: In(users.map((user) => user.id)),
        appKey: In(['leadflow', 'sales']),
        access: 'blocked',
      },
      select: { workspaceUserId: true },
    });
    const blockedIds = new Set(blocked.map((item) => item.workspaceUserId));
    return users
      .filter((user) => user.userId && !blockedIds.has(user.id))
      .map((user) => user.userId as string);
  }

  private async notificationChannelResults(
    notificationId: string,
    recipientUserIds: string[],
    channels: Array<'in_app' | 'push' | 'email'>,
    duplicate: boolean,
  ): Promise<HotLeadChannelResult[]> {
    const recipients = await this.notificationRecipients.find({
      where: { notificationId, userId: In(recipientUserIds) },
      relations: { deliveries: true },
    });
    const byUser = new Map(recipients.map((item) => [item.userId, item]));

    return recipientUserIds.flatMap((recipientUserId) =>
      channels.map((channel) => {
        const delivery = byUser
          .get(recipientUserId)
          ?.deliveries.find((item) => String(item.channel) === channel);
        return {
          recipientUserId,
          channel,
          status: delivery
            ? mapNotificationDelivery(delivery, duplicate)
            : missingNotificationDelivery(channel),
        };
      }),
    );
  }

  private async deliverWhatsApp(
    input: AutomationNotificationInput,
    opportunity: CrmOpportunityEntity,
    recipientUserIds: string[],
    workspaceName: string,
    leadDisplayName: string,
    leadScore: string,
  ): Promise<HotLeadChannelResult[]> {
    const [profiles, preferenceRows] = await Promise.all([
      this.profiles.find({
        where: {
          tenantId: input.tenantId,
          userId: In(recipientUserIds),
        },
        select: { userId: true, phone: true },
      }),
      this.notificationPreferences.find({
        where: {
          tenantId: input.tenantId,
          userId: In(recipientUserIds),
        },
        select: { userId: true, preferences: true },
      }),
    ]);
    const phoneByUser = new Map(
      profiles.map((profile) => [profile.userId, profile.phone?.trim() ?? '']),
    );
    const whatsappPreferenceByUser = new Map(
      preferenceRows.map((row) => [
        row.userId,
        acceptsHotLeadWhatsApp(row.preferences),
      ]),
    );
    const variables: HotLeadWhatsAppTemplateVariables = {
      workspaceName,
      leadDisplayName,
      leadScore,
    };

    const results: HotLeadChannelResult[] = [];
    for (const recipientUserId of recipientUserIds) {
      if (whatsappPreferenceByUser.get(recipientUserId) !== true) {
        results.push({
          recipientUserId,
          channel: 'platform_whatsapp',
          status: 'skipped_preference_disabled',
        });
        continue;
      }
      const phone = phoneByUser.get(recipientUserId);
      if (!phone) {
        results.push({
          recipientUserId,
          channel: 'platform_whatsapp',
          status: 'skipped_recipient_unavailable',
        });
        continue;
      }
      try {
        const outcome = await this.whatsapp.deliverOnce({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          subjectType: 'crm_opportunity',
          subjectId: input.opportunityId,
          handoffCycleId: `${input.policyVersion}:${input.cycleId}`,
          recipientUserId,
          templateKey: LEADFLOW_HOT_LEAD_TEMPLATE_KEY,
          businessModeKey: opportunity.businessMode,
          toPhoneE164: phone,
          variables,
        });
        results.push({
          recipientUserId,
          channel: 'platform_whatsapp',
          status: mapWhatsAppOutcome(outcome),
        });
      } catch (error) {
        this.logger.warn(
          `Hot-lead platform WhatsApp delivery failed: ${errorName(error)}`,
        );
        results.push({
          recipientUserId,
          channel: 'platform_whatsapp',
          status: 'failed',
        });
      }
    }
    return results;
  }
}

function mapNotificationDelivery(
  delivery: NotificationDeliveryEntity,
  duplicate: boolean,
): HotLeadDeliveryStatus {
  if (duplicate && delivery.status === NotificationDeliveryStatus.SENT) {
    return 'skipped_duplicate';
  }
  if (delivery.status === NotificationDeliveryStatus.SENT) return 'sent';
  if (delivery.status === NotificationDeliveryStatus.FAILED) return 'failed';
  if (delivery.failureReason === 'skipped_web_push_unavailable') {
    return 'skipped_web_push_unavailable';
  }
  return 'skipped_channel_unavailable';
}

function missingNotificationDelivery(
  channel: 'in_app' | 'push' | 'email',
): HotLeadDeliveryStatus {
  if (channel === 'in_app' || channel === 'push') {
    return 'skipped_preference_disabled';
  }
  if (channel === 'email') return 'skipped_email_unavailable';
  return 'skipped_channel_unavailable';
}

function mapWhatsAppOutcome(
  outcome: Awaited<ReturnType<PlatformWhatsAppDeliveryService['deliverOnce']>>,
): HotLeadDeliveryStatus {
  if (outcome.status === 'sent') return 'sent';
  if (outcome.status === 'already_sent') return 'skipped_duplicate';
  if (outcome.status === 'failed') return 'failed';
  if (outcome.reasonCode === 'provider_disabled') {
    return 'skipped_whatsapp_provider_disabled';
  }
  if (outcome.reasonCode === 'template_unavailable') {
    return 'skipped_whatsapp_template_unavailable';
  }
  return 'skipped_recipient_unavailable';
}

function crossResults(
  recipients: string[],
  channels: Array<'in_app' | 'push' | 'email'>,
  status: HotLeadDeliveryStatus,
): HotLeadChannelResult[] {
  return recipients.flatMap((recipientUserId) =>
    channels.map((channel) => ({ recipientUserId, channel, status })),
  );
}

function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function maskPhone(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/[^\d]/g, '');
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown_error';
}

function acceptsHotLeadWhatsApp(
  preferences: Array<Record<string, unknown>>,
): boolean {
  const exact = preferences.find(
    (preference) => preference.key === 'leadflow.hot_lead.detected',
  );
  if (!exact) return false;
  if (typeof exact.whatsapp === 'boolean') return exact.whatsapp;
  const channels = exact.channels;
  return Boolean(
    channels &&
    typeof channels === 'object' &&
    !Array.isArray(channels) &&
    (channels as Record<string, unknown>).whatsapp === true,
  );
}
