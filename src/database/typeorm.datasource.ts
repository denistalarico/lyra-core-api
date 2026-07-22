import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { UserPreferencesEntity } from '../modules/settings/entities/user-preferences.entity';
import { WorkspaceSettingsAiEntity } from '../modules/settings/entities/workspace-settings-ai.entity';
import { WorkspaceSettingsCompanyEntity } from '../modules/settings/entities/workspace-settings-company.entity';
import { UserProfileEntity } from '../modules/settings/entities/user-profile.entity';
import { WorkspaceUserEntity } from '../modules/settings/entities/workspace-user.entity';
import { WorkspaceUserModuleAccessEntity } from '../modules/settings/entities/workspace-user-module-access.entity';
import { CreateSettingsTables1760000000000 } from './migrations/1760000000000-create-settings-tables';
import { AddCompanyBrandAssets1760000001000 } from './migrations/1760000001000-add-company-brand-assets';
import { AlterCompanyBrandLogoUrlToText1760000002000 } from './migrations/1760000002000-alter-company-brand-logo-url-to-text';
import { CreateUserProfile1760000003000 } from './migrations/1760000003000-create-user-profile';
import { CreateWorkspaceUsers1760000004000 } from './migrations/1760000004000-create-workspace-users';
import { WorkspaceSettingsEmailEntity } from '../modules/settings/entities/workspace-settings-email.entity';
import { CreateWorkspaceSettingsEmail1760000005000 } from './migrations/1760000005000-create-workspace-settings-email';
import { CreateWorkspaceIntegrations1760000006000 } from './migrations/1760000006000-create-workspace-integrations';
import { UserSecuritySettingsEntity } from '../modules/settings/entities/user-security-settings.entity';
import { UserSessionEntity } from '../modules/settings/entities/user-session.entity';
import { UserTrustedDeviceEntity } from '../modules/settings/entities/user-trusted-device.entity';
import { CreateSecurityLogin1760000007000 } from './migrations/1760000007000-create-security-login';
import { UserNotificationEntity } from '../modules/settings/entities/user-notification.entity';
import { CreateUserNotifications1760000008000 } from './migrations/1760000008000-create-user-notifications';
import { CreatePasswordResets1760000009000 } from './migrations/1760000009000-create-password-resets';
import { PasswordResetEntity } from '../modules/auth/entities/password-reset.entity';
import { EmailTwoFactorCodeEntity } from '../modules/auth/entities/email-2fa-code.entity';
import { AddEmailTwoFactor1760000010000 } from './migrations/1760000010000-add-email-two-factor';
import { AddLoginContextToUserSessions1760000011000 } from './migrations/1760000011000-add-login-context-to-user-sessions';
import { AddTrustedDeviceContext1760000012000 } from './migrations/1760000012000-add-trusted-device-context';
import { AddSettingsImagePaths1760000013000 } from './migrations/1760000013000-add-settings-image-paths';
import { WorkspaceUserInvitationEntity } from '../modules/settings/entities/workspace-user-invitation.entity';
import { CreateWorkspaceUserInvitations1760000014000 } from './migrations/1760000014000-create-workspace-user-invitations';
import { ContactEntity } from '../modules/contacts/entities/contact.entity';
import { ContactMethodEntity } from '../modules/contacts/entities/contact-method.entity';
import { ContactAddressEntity } from '../modules/contacts/entities/contact-address.entity';
import { ContactListEntity } from '../modules/contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../modules/contacts/entities/contact-list-member.entity';
import { ContactTagEntity } from '../modules/contacts/entities/contact-tag.entity';
import { ContactTagAssignmentEntity } from '../modules/contacts/entities/contact-tag-assignment.entity';
import { CreateContactsCore1760000015000 } from './migrations/1760000015000-create-contacts-core';
import { ContactCustomFieldEntity } from '../modules/contacts/entities/contact-custom-field.entity';
import { ContactCustomFieldValueEntity } from '../modules/contacts/entities/contact-custom-field-value.entity';
import { ContactSegmentEntity } from '../modules/contacts/entities/contact-segment.entity';
import { ContactBusinessModeEntity } from '../modules/contacts/entities/contact-business-mode.entity';
import { ContactViewPreferenceEntity } from '../modules/contacts/entities/contact-view-preference.entity';
import { CreateContactsSettings1760000016000 } from './migrations/1760000016000-create-contacts-settings';
import { AddContactListParent1760000017000 } from './migrations/1760000017000-add-contact-list-parent';
import { WebchatWidgetEntity } from '../modules/webchat/entities/webchat-widget.entity';
import { WebchatVisitorEntity } from '../modules/webchat/entities/webchat-visitor.entity';
import { WebchatConversationEntity } from '../modules/webchat/entities/webchat-conversation.entity';
import { WebchatMessageEntity } from '../modules/webchat/entities/webchat-message.entity';
import { ScheduledItemEntity } from '../modules/appointments/entities/scheduled-item.entity';
import { ScheduledItemParticipantEntity } from '../modules/appointments/entities/scheduled-item-participant.entity';
import { ScheduledItemReminderEntity } from '../modules/appointments/entities/scheduled-item-reminder.entity';
import { InboxChannelEntity } from '../modules/inbox/entities/inbox-channel.entity';
import { InboxConversationEntity } from '../modules/inbox/entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../modules/inbox/entities/inbox-message.entity';
import { InboxSettingsEntity } from '../modules/inbox/entities/inbox-settings.entity';
import { InboxConversationParticipantEntity } from '../modules/inbox/entities/inbox-conversation-participant.entity';
import { InboxConversationEventEntity } from '../modules/inbox/entities/inbox-conversation-event.entity';
import { CreateWebchatCore1760000018000 } from './migrations/1760000018000-create-webchat-core';
import { CreateAppointmentsCore1760000019000 } from './migrations/1760000019000-create-appointments-core';
import { CreateInboxCore1760000020000 } from './migrations/1760000020000-create-inbox-core';
import { CreateInboxSettings1760000021000 } from './migrations/1760000021000-create-inbox-settings';
import { CrmPipelineEntity } from '../modules/crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../modules/crm/entities/crm-stage.entity';
import { CrmStageTransitionPolicyEntity } from '../modules/crm/entities/crm-stage-transition-policy.entity';
import { CrmOpportunityEntity } from '../modules/crm/entities/crm-opportunity.entity';
import { CrmActivityEntity } from '../modules/crm/entities/crm-activity.entity';
import { CrmTagEntity } from '../modules/crm/entities/crm-tag.entity';
import { CrmOpportunityTagEntity } from '../modules/crm/entities/crm-opportunity-tag.entity';
import { CrmOpportunityEventEntity } from '../modules/crm/entities/crm-opportunity-event.entity';
import { CreateCrmCore1760000022000 } from './migrations/1760000022000-create-crm-core';
import { ExpandCrmKanbanSettings1760000023000 } from './migrations/1760000023000-expand-crm-kanban-settings';
import { ExpandInboxChannelsFoundation1760000024000 } from './migrations/1760000024000-expand-inbox-channels-foundation';
import { InboxWebhookLogEntity } from '../modules/inbox/entities/inbox-webhook-log.entity';
import { CreateInboxWebhookLogs1760000025000 } from './migrations/1760000025000-create-inbox-webhook-logs';
import { InboxChannelConnectionSessionEntity } from '../modules/inbox/entities/inbox-channel-connection-session.entity';
import { CreateInboxChannelConnectionSessions1760000026000 } from './migrations/1760000026000-create-inbox-channel-connection-sessions';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),
  username: process.env.DB_USERNAME ?? 'lyra',
  password: process.env.DB_PASSWORD ?? 'lyra_dev_password',
  database: process.env.DB_NAME ?? 'lyra_core',
  synchronize: false,
  logging: false,
  entities: [
    UserPreferencesEntity,
    WorkspaceSettingsAiEntity,
    WorkspaceSettingsCompanyEntity,
    UserProfileEntity,
    WorkspaceUserEntity,
    WorkspaceUserModuleAccessEntity,
    WorkspaceSettingsEmailEntity,
    UserSecuritySettingsEntity,
    UserSessionEntity,
    UserTrustedDeviceEntity,
    UserNotificationEntity,
    WorkspaceUserInvitationEntity,
    PasswordResetEntity,
    EmailTwoFactorCodeEntity,
    ContactEntity,
    ContactMethodEntity,
    ContactAddressEntity,
    ContactListEntity,
    ContactListMemberEntity,
    ContactTagEntity,
    ContactTagAssignmentEntity,
    ContactCustomFieldEntity,
    ContactCustomFieldValueEntity,
    ContactSegmentEntity,
    ContactBusinessModeEntity,
    ContactViewPreferenceEntity,
    WebchatWidgetEntity,
    WebchatVisitorEntity,
    WebchatConversationEntity,
    WebchatMessageEntity,
    ScheduledItemEntity,
    ScheduledItemParticipantEntity,
    ScheduledItemReminderEntity,
    InboxChannelEntity,
    InboxConversationEntity,
    InboxMessageEntity,
    InboxSettingsEntity,
    InboxConversationParticipantEntity,
    InboxConversationEventEntity,
    CrmPipelineEntity,
    CrmStageEntity,
    CrmStageTransitionPolicyEntity,
    CrmOpportunityEntity,
    CrmActivityEntity,
    CrmTagEntity,
    CrmOpportunityTagEntity,
    CrmOpportunityEventEntity,
    InboxWebhookLogEntity,
    InboxChannelConnectionSessionEntity,
  ],
  migrations: [
    CreateSettingsTables1760000000000,
    AddCompanyBrandAssets1760000001000,
    AlterCompanyBrandLogoUrlToText1760000002000,
    CreateUserProfile1760000003000,
    CreateWorkspaceUsers1760000004000,
    CreateWorkspaceSettingsEmail1760000005000,
    CreateWorkspaceIntegrations1760000006000,
    CreateSecurityLogin1760000007000,
    CreateUserNotifications1760000008000,
    CreatePasswordResets1760000009000,
    AddEmailTwoFactor1760000010000,
    AddLoginContextToUserSessions1760000011000,
    AddTrustedDeviceContext1760000012000,
    AddSettingsImagePaths1760000013000,
    CreateWorkspaceUserInvitations1760000014000,
    CreateContactsCore1760000015000,
    CreateContactsSettings1760000016000,
    AddContactListParent1760000017000,
    CreateWebchatCore1760000018000,
    CreateAppointmentsCore1760000019000,
    CreateInboxCore1760000020000,
    CreateInboxSettings1760000021000,
    CreateCrmCore1760000022000,
    ExpandCrmKanbanSettings1760000023000,
    ExpandInboxChannelsFoundation1760000024000,
    CreateInboxWebhookLogs1760000025000,
    CreateInboxChannelConnectionSessions1760000026000,
  ],
});
