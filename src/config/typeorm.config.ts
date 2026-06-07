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
import { InboxConversationEntity } from '../modules/inbox/entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../modules/inbox/entities/inbox-message.entity';
import { InboxSettingsEntity } from '../modules/inbox/entities/inbox-settings.entity';
import { InboxConversationParticipantEntity } from '../modules/inbox/entities/inbox-conversation-participant.entity';
import { InboxConversationEventEntity } from '../modules/inbox/entities/inbox-conversation-event.entity';
import { InboxWebhookLogEntity } from '../modules/inbox/entities/inbox-webhook-log.entity';
import { InboxChannelConnectionSessionEntity } from '../modules/inbox/entities/inbox-channel-connection-session.entity';

import { CrmPipelineEntity } from '../modules/crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../modules/crm/entities/crm-stage.entity';
import { CrmOpportunityEntity } from '../modules/crm/entities/crm-opportunity.entity';
import { CrmActivityEntity } from '../modules/crm/entities/crm-activity.entity';
import { CrmTagEntity } from '../modules/crm/entities/crm-tag.entity';
import { CrmOpportunityTagEntity } from '../modules/crm/entities/crm-opportunity-tag.entity';
import { CrmOpportunityEventEntity } from '../modules/crm/entities/crm-opportunity-event.entity';

import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyPasswordResetEntity,
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
import { AgencyClient } from '../modules/clients/entities';

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

export const agencyEntities = [
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
  AgencyPasswordResetEntity,
  AgencyEmailTwoFactorCodeEntity,
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
  AgencySalesItemEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
  AgencySalesOpportunityEntity,
  AgencySalesOpportunityItemEntity,
  AgencySalesActivityEntity,
  AgencyContactProfileEntity,
  AgencyContactIdentificationTypeEntity,
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
  AgencyActivity,
  AgencyActivityLink,
  FinanceAccount,
  FinanceBankAccount,
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
  TeamConfigOption,
  TeamMember,
  TeamMemberSkill,
  TeamMemberPresence,
  TeamAttendanceEntry,
  TeamPaymentBatch,
  TeamPayment,
  TeamPaymentItem,
  TeamPaymentDocument,
  AgencyKnowledgeArticle,
  AgencyKnowledgeArticleVersion,
  AgencyKnowledgeCategory,
  AgencyKnowledgeComment,
  AgencyKnowledgeQuickNote,
  AgencyKnowledgeReaction,
  AgencyKnowledgeVaultAccessLog,
  AgencyKnowledgeVaultItem,
  AgencyKnowledgeVaultPermission,
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
      InboxChannelEntity,
      InboxConversationEntity,
      InboxMessageEntity,
      InboxSettingsEntity,
      InboxConversationParticipantEntity,
      InboxConversationEventEntity,
      InboxWebhookLogEntity,
      InboxChannelConnectionSessionEntity,
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
