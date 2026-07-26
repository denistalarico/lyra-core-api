import type { ObjectLiteral, Repository } from 'typeorm';
import {
  AgencyUserNotificationPreferencesEntity,
  AgencyUserProfileEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from '../../agency/entities/agency-settings.entities';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmPipelineEntity } from '../../crm/entities/crm-pipeline.entity';
import { NotificationRecipientEntity } from '../../notifications/entities';
import type { PlatformWhatsAppDeliveryService } from '../../notifications/platform-whatsapp/platform-whatsapp-delivery.service';
import type { NotificationEventProcessorService } from '../../notifications/services';
import {
  LeadFlowAutomationNotificationPublisher,
  type AutomationNotificationInput,
} from './leadflow-automation-notification.publisher';

function input(
  overrides: Partial<AutomationNotificationInput> = {},
): AutomationNotificationInput {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    idempotencyKey: 'effect:abc',
    opportunityId: 'opportunity-1',
    targetUserId: null,
    notifyOpportunityOwner: true,
    notifyPipelineOwner: false,
    notifyPipelineParticipants: false,
    specificRecipientUserIds: [],
    channels: ['in_app'],
    cycleId: 'event-1',
    policyVersion: 'score-v1',
    currentScore: 82,
    title: 'Lead quente',
    body: 'Um lead cruzou o limiar.',
    actionUrl: '/leadflow/crm',
    ...overrides,
  };
}

function build(
  overrides: {
    opportunity?: unknown;
    workspaceUsers?: unknown[];
    process?: jest.MockedFunction<NotificationEventProcessorService['process']>;
    notificationRecipients?: unknown[];
    deliverOnce?: jest.Mock;
    notificationPreferences?: Array<Record<string, unknown>>;
  } = {},
) {
  const process: jest.MockedFunction<
    NotificationEventProcessorService['process']
  > =
    overrides.process ??
    jest
      .fn<
        ReturnType<NotificationEventProcessorService['process']>,
        Parameters<NotificationEventProcessorService['process']>
      >()
      .mockResolvedValue({
        status: 'created',
        notificationId: 'notification-1',
        recipientCount: 1,
      });
  const deliverOnce =
    overrides.deliverOnce ??
    jest.fn().mockResolvedValue({
      status: 'skipped',
      reasonCode: 'template_unavailable',
    });
  const opportunity = {
    id: 'opportunity-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    pipelineId: 'pipeline-1',
    assignedUserId: 'user-1',
    title: 'Lead',
    contactName: 'João',
    contactPhone: '+5511999998888',
    businessMode: 'general',
    ...(overrides.opportunity as object),
  };

  const repo = <T extends ObjectLiteral>(value: Partial<Repository<T>>) =>
    value as Repository<T>;
  const publisher = new LeadFlowAutomationNotificationPublisher(
    { process } as unknown as NotificationEventProcessorService,
    { deliverOnce } as unknown as PlatformWhatsAppDeliveryService,
    repo<CrmOpportunityEntity>({
      findOne: jest.fn().mockResolvedValue(opportunity),
    }),
    repo<CrmPipelineEntity>({
      findOne: jest.fn().mockResolvedValue(null),
    }),
    repo<AgencyWorkspaceUserEntity>({
      find: jest
        .fn()
        .mockResolvedValue(
          overrides.workspaceUsers ?? [{ id: 'member-1', userId: 'user-1' }],
        ),
    }),
    repo<AgencyWorkspaceUserPermissionEntity>({
      find: jest.fn().mockResolvedValue([]),
    }),
    repo<AgencyUserProfileEntity>({
      find: jest
        .fn()
        .mockResolvedValue([{ userId: 'user-1', phone: '+5511999990000' }]),
    }),
    repo<AgencyUserNotificationPreferencesEntity>({
      find: jest.fn().mockResolvedValue(
        overrides.notificationPreferences ?? [
          {
            userId: 'user-1',
            preferences: [
              { key: 'leadflow.hot_lead.detected', whatsapp: true },
            ],
          },
        ],
      ),
    }),
    repo<AgencyWorkspaceCompanySettingsEntity>({
      findOne: jest.fn().mockResolvedValue({ workspaceName: 'Acme' }),
    }),
    repo<NotificationRecipientEntity>({
      find: jest.fn().mockResolvedValue(
        overrides.notificationRecipients ?? [
          {
            userId: 'user-1',
            deliveries: [{ channel: 'in_app', status: 'sent' }],
          },
        ],
      ),
    }),
  );
  return { publisher, process, deliverOnce };
}

describe('LeadFlowAutomationNotificationPublisher', () => {
  it('publishes the canonical event to the active opportunity owner', async () => {
    const { publisher, process } = build();

    const outcome = await publisher.publish(input());

    expect(outcome).toMatchObject({
      status: 'processed',
      notificationId: 'notification-1',
      recipientUserIds: ['user-1'],
      channelResults: [
        { recipientUserId: 'user-1', channel: 'in_app', status: 'sent' },
      ],
    });
    expect(process.mock.calls[0]?.[0]).toMatchObject({
      eventId: 'effect:abc:notifications',
      eventType: 'leadflow.hot_lead.detected',
      recipients: [{ userId: 'user-1' }],
      payload: {
        leadScore: 82,
        policyVersion: 'score-v1',
        cycleId: 'event-1',
        deliveryChannels: ['in_app'],
      },
    });
  });

  it('deduplicates recipient rules and excludes users no longer active', async () => {
    const { publisher, process } = build({ workspaceUsers: [] });

    const outcome = await publisher.publish(
      input({
        targetUserId: 'user-1',
        specificRecipientUserIds: ['user-1', 'user-1'],
      }),
    );

    expect(outcome).toEqual({ status: 'no_recipient', channelResults: [] });
    expect(process).not.toHaveBeenCalled();
  });

  it('keeps a WhatsApp template failure isolated from in-app delivery', async () => {
    const { publisher, deliverOnce } = build();

    const outcome = await publisher.publish(
      input({ channels: ['in_app', 'platform_whatsapp'] }),
    );

    expect(outcome.status).toBe('processed');
    if (outcome.status === 'processed') {
      expect(outcome.channelResults).toEqual(
        expect.arrayContaining([
          { recipientUserId: 'user-1', channel: 'in_app', status: 'sent' },
          {
            recipientUserId: 'user-1',
            channel: 'platform_whatsapp',
            status: 'skipped_whatsapp_template_unavailable',
          },
        ]),
      );
    }
    expect(deliverOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: 'leadflow.hot_lead.detected',
        variables: {
          workspaceName: 'Acme',
          leadDisplayName: 'João',
          leadScore: '82',
        },
      }),
    );
  });

  it('does not send WhatsApp when the recipient preference is disabled', async () => {
    const { publisher, deliverOnce } = build({
      notificationPreferences: [
        {
          userId: 'user-1',
          preferences: [{ key: 'leadflow.hot_lead.detected', whatsapp: false }],
        },
      ],
    });

    const outcome = await publisher.publish(
      input({ channels: ['platform_whatsapp'] }),
    );

    expect(outcome).toMatchObject({
      status: 'processed',
      channelResults: [
        {
          recipientUserId: 'user-1',
          channel: 'platform_whatsapp',
          status: 'skipped_preference_disabled',
        },
      ],
    });
    expect(deliverOnce).not.toHaveBeenCalled();
  });
});
