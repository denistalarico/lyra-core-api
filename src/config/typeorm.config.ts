import { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { UserPreferencesEntity } from '../modules/settings/entities/user-preferences.entity';
import { WorkspaceSettingsAiEntity } from '../modules/settings/entities/workspace-settings-ai.entity';
import { WorkspaceSettingsCompanyEntity } from '../modules/settings/entities/workspace-settings-company.entity';
import { UserProfileEntity } from '../modules/settings/entities/user-profile.entity';
import { WorkspaceUserEntity } from '../modules/settings/entities/workspace-user.entity';
import { WorkspaceUserModuleAccessEntity } from '../modules/settings/entities/workspace-user-module-access.entity';
import { WorkspaceSettingsEmailEntity } from '../modules/settings/entities/workspace-settings-email.entity';
import { WorkspaceIntegrationEntity } from '../modules/settings/entities/workspace-integration.entity';
import { UserSecuritySettingsEntity } from '../modules/settings/entities/user-security-settings.entity';
import { UserSessionEntity } from '../modules/settings/entities/user-session.entity';
import { UserTrustedDeviceEntity } from '../modules/settings/entities/user-trusted-device.entity';
import { UserNotificationEntity } from '../modules/settings/entities/user-notification.entity';
import { WorkspaceUserInvitationEntity } from '../modules/settings/entities/workspace-user-invitation.entity';

import { PasswordResetEntity } from '../modules/auth/entities/password-reset.entity';
import { EmailTwoFactorCodeEntity } from '../modules/auth/entities/email-2fa-code.entity';

import { ContactEntity } from '../modules/contacts/entities/contact.entity';
import { ContactMethodEntity } from '../modules/contacts/entities/contact-method.entity';
import { ContactAddressEntity } from '../modules/contacts/entities/contact-address.entity';
import { ContactListEntity } from '../modules/contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../modules/contacts/entities/contact-list-member.entity';
import { ContactTagEntity } from '../modules/contacts/entities/contact-tag.entity';
import { ContactTagAssignmentEntity } from '../modules/contacts/entities/contact-tag-assignment.entity';
import { ContactCompanyLinkEntity } from '../modules/contacts/entities/contact-company-link.entity';
import { ContactCustomFieldEntity } from '../modules/contacts/entities/contact-custom-field.entity';
import { ContactCustomFieldValueEntity } from '../modules/contacts/entities/contact-custom-field-value.entity';
import { ContactSegmentEntity } from '../modules/contacts/entities/contact-segment.entity';
import { ContactBusinessModeEntity } from '../modules/contacts/entities/contact-business-mode.entity';
import { ContactViewPreferenceEntity } from '../modules/contacts/entities/contact-view-preference.entity';

import { WebchatWidgetEntity } from '../modules/webchat/entities/webchat-widget.entity';
import { WebchatVisitorEntity } from '../modules/webchat/entities/webchat-visitor.entity';
import { WebchatConversationEntity } from '../modules/webchat/entities/webchat-conversation.entity';
import { WebchatMessageEntity } from '../modules/webchat/entities/webchat-message.entity';

import { ScheduledItemEntity } from '../modules/appointments/entities/scheduled-item.entity';
import { ScheduledItemParticipantEntity } from '../modules/appointments/entities/scheduled-item-participant.entity';
import { ScheduledItemReminderEntity } from '../modules/appointments/entities/scheduled-item-reminder.entity';

import { InboxChannelEntity } from '../modules/inbox/entities/inbox-channel.entity';
import { InboxChannelLifecycleRequestEntity } from '../modules/inbox/entities/inbox-channel-lifecycle-request.entity';
import { InboxConversationEntity } from '../modules/inbox/entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../modules/inbox/entities/inbox-message.entity';
import { InboxSettingsEntity } from '../modules/inbox/entities/inbox-settings.entity';
import { InboxConversationParticipantEntity } from '../modules/inbox/entities/inbox-conversation-participant.entity';
import { InboxConversationEventEntity } from '../modules/inbox/entities/inbox-conversation-event.entity';
import { InboxWebhookLogEntity } from '../modules/inbox/entities/inbox-webhook-log.entity';
import { InboxChannelConnectionSessionEntity } from '../modules/inbox/entities/inbox-channel-connection-session.entity';
import { InboxMediaAssetEntity } from '../modules/inbox/entities/inbox-media-asset.entity';
import { InboxMediaDerivativeEntity } from '../modules/inbox/entities/inbox-media-derivative.entity';
import { InboxProcessingBatchEntity } from '../modules/inbox/entities/inbox-processing-batch.entity';
import { InboxAgentDecisionEntity } from '../modules/inbox/entities/inbox-agent-decision.entity';
import { InboxDomainOutboxEntity } from '../modules/inbox/entities/inbox-domain-outbox.entity';
import { InboxMetaOperationEntity } from '../modules/inbox/entities/inbox-meta-operation.entity';
import { InboxGovernedActionEntity } from '../modules/inbox/entities/inbox-governed-action.entity';
import { InboxChannelContactIdentityEntity } from '../modules/inbox/entities/inbox-channel-contact-identity.entity';
import { InboxAutonomyControlEntity } from '../modules/inbox/entities/inbox-autonomy-control.entity';

import { CrmPipelineEntity } from '../modules/crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../modules/crm/entities/crm-stage.entity';
import { CrmStageTransitionPolicyEntity } from '../modules/crm/entities/crm-stage-transition-policy.entity';
import { CrmOpportunityEntity } from '../modules/crm/entities/crm-opportunity.entity';
import { CrmActivityEntity } from '../modules/crm/entities/crm-activity.entity';
import { CrmTagEntity } from '../modules/crm/entities/crm-tag.entity';
import { CrmOpportunityTagEntity } from '../modules/crm/entities/crm-opportunity-tag.entity';
import { CrmOpportunityEventEntity } from '../modules/crm/entities/crm-opportunity-event.entity';

import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyPasswordResetEntity,
  AgencyUserLoginEventEntity,
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
  AgencyUserTrustedDeviceEntity,
} from '../modules/agency/entities/agency-auth.entities';

import {
  AgencyUserNotificationPreferencesEntity,
  AgencyUserPreferencesEntity,
  AgencyUserProfileEntity,
  AgencyWorkspaceAdvancedSettingsEntity,
  AgencyWorkspaceAppsSettingsEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceEmailSettingsEntity,
  AgencyWorkspaceFinanceSettingsEntity,
  AgencyWorkspaceIntegrationEntity,
  AgencyWorkspaceNotificationSettingsEntity,
  AgencyWorkspaceSecuritySettingsEntity,
  AgencyWorkspaceSubscriptionSettingsEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from '../modules/agency/entities/agency-settings.entities';

import {
  AgencySalesActivityEntity,
  AgencySalesItemEntity,
  AgencySalesOpportunityEntity,
  AgencySalesOpportunityItemEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
} from '../modules/agency/entities/agency-sales.entities';

import {
  QuoteEntity,
  QuoteItemEntity,
  QuoteStatusHistoryEntity,
  QuoteTemplateEntity,
  QuoteTemplateSectionEntity,
} from '../modules/quotes/entities/quote.entities';

import {
  AgencyBankEntity,
  AgencyContactBankAccountEntity,
  AgencyContactIdentificationTypeEntity,
  AgencyContactProfileEntity,
  AgencyContactSourceEntity,
} from '../modules/agency/entities/agency-contact-details.entities';

import {
  DocumentLayoutEntity,
  DocumentLayoutTemplateEntity,
} from '../modules/document-layouts/entities/document-layout.entities';

import { CalendarEvent } from '../modules/calendar/entities/calendar-event.entity';
import { CalendarRoutineBlock } from '../modules/calendar/entities/calendar-routine-block.entity';
import { CalendarSettings } from '../modules/calendar/entities/calendar-settings.entity';
import {
  FinanceAccount,
  FinanceBankAccount,
  FinanceBankTransfer,
  FinanceCategory,
  FinanceCostCenter,
  FinanceDocumentSequence,
  FinanceFiscalProfile,
  FinancePaymentProvider,
  FinanceJournal,
  FinanceJournalEntry,
  FinanceJournalEntryLine,
  FinanceMetricSnapshot,
  FinancePeriod,
  FinanceProfitabilityRule,
  FinanceReportSnapshot,
  FinanceSetting,
  FinanceTag,
  FinanceInvoice,
  FinanceInvoiceLine,
  FinanceBill,
  FinanceBillLine,
  FinanceBillRecurrence,
  FinancePayment,
  FinancePaymentAllocation,
  FinanceRecurringProfile,
} from '../modules/finance/entities';

import {
  AgencyActivity,
  AgencyActivityLink,
} from '../modules/activities/entities';

import {
  ContractDocument,
  ContractEvent,
  ContractParty,
  ContractRecord,
  ContractTemplate,
  ContractTemplateVersion,
  ContractSignatureProviderSetting,
} from '../modules/contracts/entities';

import {
  TeamDepartment,
  TeamSkill,
  TeamConfigOption,
  TeamMember,
  TeamMemberSkill,
  TeamMemberPresence,
  TeamAttendanceEntry,
  TeamPayment,
  TeamPaymentBatch,
  TeamPaymentItem,
  TeamPaymentDocument,
  TeamMemberLifecycleProcess,
  TeamMemberLifecycleStep,
} from '../modules/team/entities';

import {
  AgencyPersonalTaskStage,
  AgencyProject,
  AgencyProjectAttachment,
  AgencyProjectEvent,
  AgencyProjectFollower,
  AgencyProjectSettings,
  AgencyProjectStage,
  AgencyProjectUserPreferences,
  AgencyTask,
  AgencyTaskAttachment,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskStage,
  AgencyTaskTimeEntry,
} from '../modules/projects/entities';
import {
  AgencyClient,
  ClientLifecycleProcess,
  ClientLifecycleStep,
} from '../modules/clients/entities';

import {
  AgencyKnowledgeArticle,
  AgencyKnowledgeArticleVersion,
  AgencyKnowledgeCategory,
  AgencyKnowledgeComment,
  AgencyKnowledgeQuickNote,
  AgencyKnowledgeReaction,
  AgencyKnowledgeVaultAccessLog,
  AgencyKnowledgeVaultItem,
  AgencyKnowledgeVaultPermission,
} from '../modules/knowledge/entities';
import {
  HelpArticle,
  HelpCategory,
  HelpTrail,
  HelpTrailArticle,
} from '../modules/knowledge/help/entities';

import {
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
  AgencyChatMessageRead,
  AgencyChatAttachment,
  AgencyMeetingRoom,
  AgencyMeetingParticipant,
  AgencyMeetingEvent,
  AgencyMeetingAiSummary,
} from '../modules/team-chat/entities';
import {
  PlatformAccountEntity,
  TenantProductEntitlementEntity,
} from '../modules/platform';

import {
  NotificationDeliveryEntity,
  NotificationEntity,
  NotificationPushSubscriptionEntity,
  NotificationRecipientEntity,
} from '../modules/notifications/entities';
import { PlatformWhatsAppNotificationDeliveryEntity } from '../modules/notifications/platform-whatsapp/platform-whatsapp-notification-delivery.entity';

import {
  AgencyClientAccessEntity,
  AgencyClientProductAccessEntity,
  PlatformPermissionAuditEventEntity,
  PlatformPermissionEntity,
  PlatformRoleEntity,
  PlatformRolePermissionEntity,
  PlatformUserPermissionEntity,
} from '../modules/permissions/entities';
import {
  LeadFlowBusinessModeTemplateEntity,
  LeadFlowClientSettingsEntity,
} from '../modules/leadflow-settings/entities';
import {
  LeadFlowAgentEntity,
  LeadFlowAgentVersionEntity,
  LeadFlowAgentChannelBindingEntity,
  LeadFlowAgentOperationalStateEntity,
  OperationsRoomRevisionEntity,
  OperationsRoomOutboxEntity,
} from '../modules/leadflow-agents/entities';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationGlobalConfigVersionEntity,
  LeadFlowAutomationRunAttemptEntity,
  LeadFlowAutomationRunEntity,
  LeadFlowScheduledTimerEntity,
  LeadFlowAutomationVersionEntity,
} from '../modules/leadflow-automations/entities';
import { LeadFlowEventDeliveryEntity } from '../modules/leadflow-events/entities';
import {
  LeadFlowCsatResponseEntity,
  LeadFlowIntelligenceConfigVersionEntity,
  LeadFlowIntelligenceDecisionEntity,
  LeadFlowIntelligenceRecommendationEntity,
  LeadFlowIntelligenceResultEntity,
} from '../modules/leadflow-analytics/entities';
import {
  LeadFlowProductTelemetryDailyEntity,
  LeadFlowTelemetryAuditEventEntity,
  LeadFlowTelemetryConsentEntity,
  LeadFlowTelemetryConsentNoticeEntity,
  LeadFlowTelemetryIdentityLinkEntity,
} from '../modules/leadflow-privacy/entities';
import {
  PlatformAdminAuditEventEntity,
  PlatformAdminIdentityEntity,
  PlatformAdminIdentityTokenEntity,
  PlatformAdminInvitationEntity,
  PlatformAdminSessionEntity,
  PlatformAdminTwoFactorCodeEntity,
  PlatformInternalAdminEntity,
} from '../modules/admin/entities';

export const agencyEntities = [
  PlatformInternalAdminEntity,
  PlatformAdminAuditEventEntity,
  PlatformAdminIdentityEntity,
  PlatformAdminIdentityTokenEntity,
  PlatformAdminInvitationEntity,
  PlatformAdminSessionEntity,
  PlatformAdminTwoFactorCodeEntity,
  NotificationEntity,
  NotificationRecipientEntity,
  NotificationDeliveryEntity,
  NotificationPushSubscriptionEntity,
  PlatformWhatsAppNotificationDeliveryEntity,

  DocumentLayoutEntity,
  DocumentLayoutTemplateEntity,
  AgencyUserPreferencesEntity,
  AgencyUserProfileEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceNotificationSettingsEntity,
  AgencyUserNotificationPreferencesEntity,
  AgencyWorkspaceSecuritySettingsEntity,
  AgencyWorkspaceEmailSettingsEntity,
  AgencyWorkspaceAppsSettingsEntity,
  AgencyWorkspaceFinanceSettingsEntity,
  AgencyWorkspaceSubscriptionSettingsEntity,
  AgencyWorkspaceAdvancedSettingsEntity,
  AgencyWorkspaceIntegrationEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
  AgencyUserTrustedDeviceEntity,
  AgencyUserLoginEventEntity,
  AgencyPasswordResetEntity,
  AgencyEmailTwoFactorCodeEntity,
  ContactEntity,
  ContactMethodEntity,
  ContactAddressEntity,
  ContactListEntity,
  ContactListMemberEntity,
  ContactTagEntity,
  ContactTagAssignmentEntity,
  ContactCompanyLinkEntity,
  ContactCustomFieldEntity,
  ContactCustomFieldValueEntity,
  ContactSegmentEntity,
  ContactBusinessModeEntity,
  ContactViewPreferenceEntity,
  InboxChannelEntity,
  InboxChannelLifecycleRequestEntity,
  InboxConversationEntity,
  InboxMessageEntity,
  InboxSettingsEntity,
  InboxConversationParticipantEntity,
  InboxConversationEventEntity,
  InboxWebhookLogEntity,
  InboxChannelConnectionSessionEntity,
  InboxMediaAssetEntity,
  InboxMediaDerivativeEntity,
  InboxProcessingBatchEntity,
  InboxAgentDecisionEntity,
  InboxDomainOutboxEntity,
  InboxMetaOperationEntity,
  InboxGovernedActionEntity,
  InboxChannelContactIdentityEntity,
  InboxAutonomyControlEntity,
  CrmPipelineEntity,
  CrmStageEntity,
  CrmStageTransitionPolicyEntity,
  CrmOpportunityEntity,
  CrmTagEntity,
  CrmOpportunityTagEntity,
  CrmOpportunityEventEntity,
  AgencySalesItemEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
  AgencySalesOpportunityEntity,
  AgencySalesOpportunityItemEntity,
  AgencySalesActivityEntity,
  AgencyContactProfileEntity,
  AgencyContactIdentificationTypeEntity,
  AgencyContactSourceEntity,
  AgencyBankEntity,
  QuoteEntity,
  QuoteItemEntity,
  QuoteStatusHistoryEntity,
  QuoteTemplateEntity,
  QuoteTemplateSectionEntity,
  AgencyContactBankAccountEntity,
  CalendarEvent,
  CalendarRoutineBlock,
  CalendarSettings,
  AgencyProject,
  AgencyProjectEvent,
  AgencyProjectFollower,
  AgencyProjectAttachment,
  AgencyProjectSettings,
  AgencyProjectUserPreferences,
  AgencyProjectStage,
  AgencyTask,
  AgencyTaskAttachment,
  AgencyTaskStage,
  AgencyPersonalTaskStage,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskTimeEntry,
  AgencyClient,
  ClientLifecycleProcess,
  ClientLifecycleStep,
  AgencyActivity,
  AgencyActivityLink,
  FinanceAccount,
  FinanceBankAccount,
  FinanceBankTransfer,
  FinanceCategory,
  FinanceCostCenter,
  FinanceDocumentSequence,
  FinanceFiscalProfile,
  FinancePaymentProvider,
  FinanceJournal,
  FinanceJournalEntry,
  FinanceJournalEntryLine,
  FinanceMetricSnapshot,
  FinanceInvoice,
  FinanceInvoiceLine,
  FinanceBill,
  FinanceBillLine,
  FinanceBillRecurrence,
  FinancePayment,
  FinancePaymentAllocation,
  FinanceRecurringProfile,
  FinancePeriod,
  FinanceProfitabilityRule,
  FinanceReportSnapshot,
  FinanceSetting,
  FinanceTag,
  ContractDocument,
  ContractEvent,
  ContractParty,
  ContractRecord,
  ContractTemplate,
  ContractTemplateVersion,
  ContractSignatureProviderSetting,
  TeamDepartment,
  TeamSkill,
  TeamConfigOption,
  TeamMember,
  TeamMemberSkill,
  TeamMemberPresence,
  TeamAttendanceEntry,
  TeamPaymentBatch,
  TeamPayment,
  TeamPaymentItem,
  TeamPaymentDocument,
  TeamMemberLifecycleProcess,
  TeamMemberLifecycleStep,
  AgencyKnowledgeArticle,
  AgencyKnowledgeArticleVersion,
  AgencyKnowledgeCategory,
  AgencyKnowledgeComment,
  AgencyKnowledgeQuickNote,
  AgencyKnowledgeReaction,
  AgencyKnowledgeVaultAccessLog,
  AgencyKnowledgeVaultItem,
  AgencyKnowledgeVaultPermission,
  HelpCategory,
  HelpTrail,
  HelpArticle,
  HelpTrailArticle,
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
  AgencyChatMessageRead,
  AgencyChatAttachment,
  AgencyMeetingRoom,
  AgencyMeetingParticipant,
  AgencyMeetingEvent,
  AgencyMeetingAiSummary,
  TenantProductEntitlementEntity,
  PlatformAccountEntity,
  PlatformRoleEntity,
  PlatformPermissionEntity,
  PlatformRolePermissionEntity,
  PlatformUserPermissionEntity,
  AgencyClientAccessEntity,
  AgencyClientProductAccessEntity,
  PlatformPermissionAuditEventEntity,
  LeadFlowBusinessModeTemplateEntity,
  LeadFlowClientSettingsEntity,
  LeadFlowAgentEntity,
  LeadFlowAgentVersionEntity,
  LeadFlowAgentChannelBindingEntity,
  LeadFlowAgentOperationalStateEntity,
  OperationsRoomRevisionEntity,
  OperationsRoomOutboxEntity,
  LeadFlowAutomationEntity,
  LeadFlowAutomationGlobalConfigVersionEntity,
  LeadFlowAutomationVersionEntity,
  LeadFlowAutomationRunEntity,
  LeadFlowAutomationRunAttemptEntity,
  LeadFlowScheduledTimerEntity,
  LeadFlowEventDeliveryEntity,
  LeadFlowCsatResponseEntity,
  LeadFlowIntelligenceRecommendationEntity,
  LeadFlowIntelligenceDecisionEntity,
  LeadFlowIntelligenceConfigVersionEntity,
  LeadFlowIntelligenceResultEntity,
  LeadFlowTelemetryConsentNoticeEntity,
  LeadFlowTelemetryConsentEntity,
  LeadFlowTelemetryIdentityLinkEntity,
  LeadFlowProductTelemetryDailyEntity,
  LeadFlowTelemetryAuditEventEntity,
  ScheduledItemEntity,
  ScheduledItemParticipantEntity,
  ScheduledItemReminderEntity,
];

export function getTypeOrmConfig(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5433),
    username: process.env.DB_USERNAME ?? 'lyra',
    password: process.env.DB_PASSWORD ?? 'lyra_dev_password',
    database: process.env.DB_NAME ?? 'lyra_core',
    synchronize: false,
    autoLoadEntities: false,
    logging: false,
    entities: [
      CrmPipelineEntity,
      CrmStageEntity,
      CrmStageTransitionPolicyEntity,
      CrmOpportunityEntity,
      CrmActivityEntity,
      CrmTagEntity,
      CrmOpportunityTagEntity,
      CrmOpportunityEventEntity,
      UserPreferencesEntity,
      WorkspaceSettingsAiEntity,
      WorkspaceSettingsCompanyEntity,
      UserProfileEntity,
      WorkspaceUserEntity,
      WorkspaceUserModuleAccessEntity,
      WorkspaceSettingsEmailEntity,
      WorkspaceIntegrationEntity,
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
    ],
  };
}

export function getAgencyTypeOrmConfig(): TypeOrmModuleOptions {
  return {
    name: 'agency',
    type: 'postgres',
    host: process.env.AGENCY_DB_HOST ?? process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.AGENCY_DB_PORT ?? process.env.DB_PORT ?? 5433),
    username:
      process.env.AGENCY_DB_USERNAME ?? process.env.DB_USERNAME ?? 'lyra',
    password:
      process.env.AGENCY_DB_PASSWORD ??
      process.env.DB_PASSWORD ??
      'lyra_dev_password',
    database: process.env.AGENCY_DB_NAME ?? 'lyra_agency',
    synchronize: false,
    autoLoadEntities: false,
    logging: false,
    entities: agencyEntities,
  };
}
