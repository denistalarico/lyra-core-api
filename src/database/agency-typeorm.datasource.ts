import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { agencyEntities } from '../config/typeorm.config';
import { CreateAgencySettingsCore1760001000000 } from './migrations/1760001000000-create-agency-settings-core';
import { CreateAgencyEmailSettings1760001001000 } from './migrations/1760001001000-create-agency-email-settings';
import { CreateAgencySalesCore1760001002000 } from './migrations/1760001002000-create-agency-sales-core';
import { CreateAgencySalesOpportunityItems1760001003000 } from './migrations/1760001003000-create-agency-sales-opportunity-items';
import { CreateAgencySalesActivities1760001004000 } from './migrations/1760001004000-create-agency-sales-activities';
import { CreateContactsCore1760000015000 } from './migrations/1760000015000-create-contacts-core';
import { CreateContactsSettings1760000016000 } from './migrations/1760000016000-create-contacts-settings';
import { AddContactListParent1760000017000 } from './migrations/1760000017000-add-contact-list-parent';
import { AddAgencyContactListSystemFlags1760001005000 } from './migrations/1760001005000-add-agency-contact-list-system-flags';
import { CreateAgencyContactDetails1760001006000 } from './migrations/1760001006000-create-agency-contact-details';
import { CreateDocumentLayouts1760001008000 } from './migrations/1760001008000-create-document-layouts';
import { EnhanceDocumentLayoutTemplates1760001009000 } from './migrations/1760001009000-enhance-document-layout-templates';
import { RefineDocumentLayoutTemplatesV31760001010000 } from './migrations/1760001010000-refine-document-layout-templates-v3';
import { UpdateDocumentLayoutTemplatesMultiDoc1760002038000 } from './migrations/1760002038000-update-document-layout-templates-multi-doc';
import { CreateQuotesCore1760001007000 } from './migrations/1760001007000-create-quotes-core';
import { CreateAgencyCalendarCore1760001011000 } from './migrations/1760001011000-create-agency-calendar-core';
import { CreateAgencyCalendarSettings1760001012000 } from './migrations/1760001012000-create-agency-calendar-settings';
import { CreateAgencyProjectsTasksCore1760001013000 } from './migrations/1760001013000-create-agency-projects-tasks-core';
import { AddAgencyProjectSettings1760001014000 } from './migrations/1760001014000-add-agency-project-settings';
import { CreateAgencyProjectEvents1760001015000 } from './migrations/1760001015000-create-agency-project-events';
import { AddProjectCardColors1760002033000 } from './migrations/1760002033000-add-project-card-colors';
import { AddTaskCoverAndMarkers1760002034000 } from './migrations/1760002034000-add-task-cover-and-markers';
import { AddTaskReviewApprovedStatuses1760002035000 } from './migrations/1760002035000-add-task-review-approved-statuses';
import { AddProjectIdToTaskStages1760002036000 } from './migrations/1760002036000-add-project-id-to-task-stages';
import { AddProjectFollowersAndAttachments1760002037000 } from './migrations/1760002037000-add-project-followers-and-attachments';
import { AddTaskTypeFields1760002040000 } from './migrations/1760002040000-add-task-type-fields';
import { CreateAgencyClientsCore1760002041000 } from './migrations/1760002041000-create-agency-clients-core';
import { CreateAgencyActivitiesCore1760001016000 } from './migrations/1760001016000-create-agency-activities-core';
import { CreateAgencyFinanceCore1760002016000 } from './migrations/1760002016000-create-agency-finance-core';
import { CreateAgencyFinanceBillingCore1760002017000 } from './migrations/1760002017000-create-agency-finance-billing-core';
import { CreateAgencyFinanceDocumentSequences1760002018000 } from './migrations/1760002018000-create-agency-finance-document-sequences';
import { CreateAgencyFinanceFiscalProfile1760002019000 } from './migrations/1760002019000-create-agency-finance-fiscal-profile';
import { CreateAgencyFinancePaymentProviders1760002020000 } from './migrations/1760002020000-create-agency-finance-payment-providers';
import { CreateAgencyFinanceJournalEntries1760002021000 } from './migrations/1760002021000-create-agency-finance-journal-entries';
import { CreateAgencyContractsLayer1760002022000 } from './migrations/1760002022000-create-agency-contracts-layer';
import { AddContractTemplateI18nFields1760002023000 } from './migrations/1760002023000-add-contract-template-i18n-fields';
import { CreateContractSignatureProviderSettings1760002024000 } from './migrations/1760002024000-create-contract-signature-provider-settings';
import { CreateAgencyTeamCore1760002025000 } from './migrations/1760002025000-create-agency-team-core';
import { CreateAgencyTeamAttendance1760002026000 } from './migrations/1760002026000-create-agency-team-attendance';
import { CreateAgencyTeamConfigOptions1760002031000 } from './migrations/1760002031000-create-agency-team-config-options';
import { FixTeamConfigOptionsSeniorityUniqueIndex1760002032000 } from './migrations/1760002032000-fix-team-config-options-seniority-unique-index';
import { CreateAgencyTeamPayments1760002030000 } from './migrations/1760002030000-create-agency-team-payments';
import { AddBankAccountChartAccount1760002039000 } from './migrations/1760002039000-add-bank-account-chart-account';
import { CreateAgencyKnowledgeCore1760002042000 } from './migrations/1760002042000-create-agency-knowledge-core';

import { AddKnowledgeVaultNotesEncryptionFields1760002043000 } from './migrations/1760002043000-add-knowledge-vault-notes-encryption-fields';
import { CreateAgencyTeamChatCore1760002044000 } from './migrations/1760002044000-create-agency-team-chat-core';
import { CreateAgencyChatUserSettings1760002045000 } from './migrations/1760002045000-create-agency-chat-user-settings';
import { AddTeamChatMessageActionsSupport1760002046000 } from './migrations/1760002046000-add-team-chat-message-actions-support';
import { CreateTenantProductEntitlements1760002047000 } from './migrations/1760002047000-create-tenant-product-entitlements';
import { CreatePlatformAccounts1760002048000 } from './migrations/1760002048000-create-platform-accounts';
import { CreateAgencyCrmCore1760002049000 } from './migrations/1760002049000-create-agency-crm-core';
import { CreatePlatformNotificationsLayer1760002050000 } from './migrations/1760002050000-create-platform-notifications-layer';
import { CreatePlatformPermissionsCore1760002051000 } from './migrations/1760002051000-create-platform-permissions-core';
import { EnableAdminFinanceReadPermissions1760002052000 } from './migrations/1760002052000-enable-admin-finance-read-permissions';
import { AddSprint3PermissionMatrixUpdates1760002053000 } from './migrations/1760002053000-add-sprint3-permission-matrix-updates';
import { AddSprint7ContactsPermissions1760002054000 } from './migrations/1760002054000-add-sprint7-contacts-permissions';
import { AddSprint8LeadflowAppointmentsPermissions1760002055000 } from './migrations/1760002055000-add-sprint8-leadflow-appointments-permissions';
import { AddContractTemplateLetterheadPresets1760002056000 } from './migrations/1760002056000-add-contract-template-letterhead-presets';
import { CreateTeamMemberLifecycle1760002057000 } from './migrations/1760002057000-create-team-member-lifecycle';
import { CreateClientLifecycle1760002058000 } from './migrations/1760002058000-create-client-lifecycle';
import { AddClientLifecyclePermissions1760002059000 } from './migrations/1760002059000-add-client-lifecycle-permissions';
import { CreateUserLoginEvents1760002060000 } from './migrations/1760002060000-create-user-login-events';
import { CreateNotificationPushSubscriptions1761000000000 } from './migrations/1761000000000-create-notification-push-subscriptions';
import { AddContactLifecycleStagesArray1782171244936 } from './migrations/1782171244936-add-contact-lifecycle-stages-array';
import { AddContactCompanyLinks1782171304936 } from './migrations/1782171304936-add-contact-company-links';
import { AddAgencyContactSources1782171364936 } from './migrations/1782171364936-add-agency-contact-sources';
import { AllowDraftQuotesWithoutNumber1782171424936 } from './migrations/1782171424936-allow-draft-quotes-without-number';
import { GrantManagerProjectsStagesPermission1782260931927 } from './migrations/1782260931927-grant-manager-projects-stages-permission';
import { BackfillDocumentLayoutSystemTemplates1782300000000 } from './migrations/1782300000000-backfill-document-layout-system-templates';
import { AddQuoteItemTaxType1782400000000 } from './migrations/1782400000000-add-quote-item-tax-type';
import { EvolveFinanceBankAccounts1782500000000 } from './migrations/1782500000000-evolve-finance-bank-accounts';
import { AddFinanceJournalEntryPostingFields1782600000000 } from './migrations/1782600000000-add-finance-journal-entry-posting-fields';
import { AddProjectStageTemplates1782700000000 } from './migrations/1782700000000-add-project-stage-templates';
import { AddChecklistItemAssignee1782700100000 } from './migrations/1782700100000-add-checklist-item-assignee';
import { AddSubtaskDetailAndTime1782700300000 } from './migrations/1782700300000-add-subtask-detail-and-time';
import { AddChecklistPersonalStage1782700400000 } from './migrations/1782700400000-add-checklist-personal-stage';
import { AddTaskProjectStageId1782700200000 } from './migrations/1782700200000-add-task-project-stage-id';
import { AddKnowledgePersonalScope1782700500000 } from './migrations/1782700500000-add-knowledge-personal-scope';
import { CreateAgencyFinanceBillRecurrences1782800000000 } from './migrations/1782800000000-create-agency-finance-bill-recurrences';
import { CreateAgencyHelpCenter1783000000000 } from './migrations/1783000000000-create-agency-help-center';
import { AddCrmOpportunitySortOrder1783100000000 } from './migrations/1783100000000-add-crm-opportunity-sort-order';
import { CreateLeadflowSettingsCore1783200000000 } from './migrations/1783200000000-create-leadflow-settings-core';
import { AddLeadflowAgencySettingsContext1783300000000 } from './migrations/1783300000000-add-leadflow-agency-settings-context';
import { CreateLeadflowAgentsCore1783400000000 } from './migrations/1783400000000-create-leadflow-agents-core';
import { AddLeadflowAgentsPermissions1783500000000 } from './migrations/1783500000000-add-leadflow-agents-permissions';

export const AgencyDataSource = new DataSource({
  type: 'postgres',
  host: process.env.AGENCY_DB_HOST ?? process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.AGENCY_DB_PORT ?? process.env.DB_PORT ?? 5433),
  username: process.env.AGENCY_DB_USERNAME ?? process.env.DB_USERNAME ?? 'lyra',
  password:
    process.env.AGENCY_DB_PASSWORD ??
    process.env.DB_PASSWORD ??
    'lyra_dev_password',
  database: process.env.AGENCY_DB_NAME ?? 'lyra_agency',
  synchronize: false,
  logging: false,
  entities: agencyEntities,
  migrations: [
    CreateAgencyTeamPayments1760002030000,
    CreateAgencySettingsCore1760001000000,
    CreateAgencyEmailSettings1760001001000,
    CreateAgencySalesCore1760001002000,
    CreateAgencySalesOpportunityItems1760001003000,
    CreateAgencySalesActivities1760001004000,
    CreateContactsCore1760000015000,
    CreateContactsSettings1760000016000,
    AddContactListParent1760000017000,
    AddAgencyContactListSystemFlags1760001005000,
    CreateAgencyContactDetails1760001006000,
    CreateDocumentLayouts1760001008000,
    EnhanceDocumentLayoutTemplates1760001009000,
    RefineDocumentLayoutTemplatesV31760001010000,
    UpdateDocumentLayoutTemplatesMultiDoc1760002038000,
    CreateQuotesCore1760001007000,
    CreateAgencyCalendarCore1760001011000,
    CreateAgencyCalendarSettings1760001012000,
    CreateAgencyProjectsTasksCore1760001013000,
    AddAgencyProjectSettings1760001014000,
    CreateAgencyProjectEvents1760001015000,
    AddProjectCardColors1760002033000,
    AddTaskCoverAndMarkers1760002034000,
    AddTaskReviewApprovedStatuses1760002035000,
    CreateAgencyActivitiesCore1760001016000,
    CreateAgencyFinanceCore1760002016000,
    CreateAgencyFinanceBillingCore1760002017000,
    CreateAgencyFinanceDocumentSequences1760002018000,
    CreateAgencyFinanceFiscalProfile1760002019000,
    CreateAgencyFinancePaymentProviders1760002020000,
    CreateAgencyFinanceJournalEntries1760002021000,
    CreateAgencyContractsLayer1760002022000,
    AddContractTemplateI18nFields1760002023000,
    CreateContractSignatureProviderSettings1760002024000,
    CreateAgencyTeamCore1760002025000,
    CreateAgencyTeamConfigOptions1760002031000,
    CreateAgencyTeamAttendance1760002026000,
    FixTeamConfigOptionsSeniorityUniqueIndex1760002032000,
    AddProjectIdToTaskStages1760002036000,
    AddProjectFollowersAndAttachments1760002037000,
    AddTaskTypeFields1760002040000,
    CreateAgencyClientsCore1760002041000,
    CreateAgencyKnowledgeCore1760002042000,
    AddKnowledgeVaultNotesEncryptionFields1760002043000,
    CreateAgencyTeamChatCore1760002044000,
    CreateAgencyChatUserSettings1760002045000,
    AddTeamChatMessageActionsSupport1760002046000,
    CreateTenantProductEntitlements1760002047000,
    CreatePlatformAccounts1760002048000,
    CreateAgencyCrmCore1760002049000,
    CreatePlatformNotificationsLayer1760002050000,
    AddBankAccountChartAccount1760002039000,
    CreatePlatformPermissionsCore1760002051000,
    EnableAdminFinanceReadPermissions1760002052000,
    AddSprint3PermissionMatrixUpdates1760002053000,
    AddSprint7ContactsPermissions1760002054000,
    AddSprint8LeadflowAppointmentsPermissions1760002055000,
    AddContractTemplateLetterheadPresets1760002056000,
    CreateTeamMemberLifecycle1760002057000,
    CreateClientLifecycle1760002058000,
    AddClientLifecyclePermissions1760002059000,
    CreateUserLoginEvents1760002060000,
    CreateNotificationPushSubscriptions1761000000000,
    AddContactLifecycleStagesArray1782171244936,
    AddContactCompanyLinks1782171304936,
    AddAgencyContactSources1782171364936,
    AllowDraftQuotesWithoutNumber1782171424936,
    GrantManagerProjectsStagesPermission1782260931927,
    BackfillDocumentLayoutSystemTemplates1782300000000,
    AddQuoteItemTaxType1782400000000,
    EvolveFinanceBankAccounts1782500000000,
    AddFinanceJournalEntryPostingFields1782600000000,
    AddProjectStageTemplates1782700000000,
    AddChecklistItemAssignee1782700100000,
    AddTaskProjectStageId1782700200000,
    AddSubtaskDetailAndTime1782700300000,
    AddChecklistPersonalStage1782700400000,
    AddKnowledgePersonalScope1782700500000,
    CreateAgencyFinanceBillRecurrences1782800000000,
    CreateAgencyHelpCenter1783000000000,
    AddCrmOpportunitySortOrder1783100000000,
    CreateLeadflowSettingsCore1783200000000,
    AddLeadflowAgencySettingsContext1783300000000,
    CreateLeadflowAgentsCore1783400000000,
    AddLeadflowAgentsPermissions1783500000000,
  ],
});
