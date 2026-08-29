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
import { ReconcileAgencyTeamConfigOptionsSchema1760002031500 } from './migrations/1760002031500-reconcile-agency-team-config-options-schema';
import { FixTeamConfigOptionsSeniorityUniqueIndex1760002032000 } from './migrations/1760002032000-fix-team-config-options-seniority-unique-index';
import { CreateAgencyTeamPayments1760002030000 } from './migrations/1760002030000-create-agency-team-payments';
import { AddBankAccountChartAccount1760002039000 } from './migrations/1760002039000-add-bank-account-chart-account';
import { CreateAgencyKnowledgeCore1760002042000 } from './migrations/1760002042000-create-agency-knowledge-core';
import { CreateAgencyKnowledgeQuickNotes1760002042500 } from './migrations/1760002042500-create-agency-knowledge-quick-notes';

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
import { CreateLeadflowOperationsRoom1783900000000 } from './migrations/1783900000000-create-leadflow-operations-room';
import { AddOperationsRoomOutboxDelivery1784000000000 } from './migrations/1784000000000-add-operations-room-outbox-delivery';
import { CreateLeadflowAutomationsCore1783600000000 } from './migrations/1783600000000-create-leadflow-automations-core';
import { AddLeadflowAutomationsPermissions1783700000000 } from './migrations/1783700000000-add-leadflow-automations-permissions';
import { AddLeadflowEventsPermissions1783800000000 } from './migrations/1783800000000-add-leadflow-events-permissions';
import { CreateInboxCore1760000020000 } from './migrations/1760000020000-create-inbox-core';
import { CreateInboxSettings1760000021000 } from './migrations/1760000021000-create-inbox-settings';
import { ExpandInboxChannelsFoundation1760000024000 } from './migrations/1760000024000-expand-inbox-channels-foundation';
import { CreateInboxWebhookLogs1760000025000 } from './migrations/1760000025000-create-inbox-webhook-logs';
import { CreateInboxChannelConnectionSessions1760000026000 } from './migrations/1760000026000-create-inbox-channel-connection-sessions';
import { CreateLeadflowInboxRuntime1784100000000 } from './migrations/1784100000000-create-leadflow-inbox-runtime';
import { HardenInboxSupervisedRuntime1784200000000 } from './migrations/1784200000000-harden-inbox-supervised-runtime';
import { CreateInboxProviderUsageLedger1784300000000 } from './migrations/1784300000000-create-inbox-provider-usage-ledger';
import { PrepareLeadflowAgencyPilot1784400000000 } from './migrations/1784400000000-prepare-leadflow-agency-pilot';
import { AddInboxDecisionReviewOutcomes1784500000000 } from './migrations/1784500000000-add-inbox-decision-review-outcomes';
import { EnforceDefaultAgentBindingInvariant1784510000000 } from './migrations/1784510000000-enforce-default-agent-binding-invariant';
import { AddInboxOutboxLifecycle1784520000000 } from './migrations/1784520000000-add-inbox-outbox-lifecycle';
import { HardenInboxAssistedMode1784530000000 } from './migrations/1784530000000-harden-inbox-assisted-mode';
import { CreateInboxGovernedActions1784540000000 } from './migrations/1784540000000-create-inbox-governed-actions';
import { ScopeCrmOpportunityUniquenessToOpen1784550000000 } from './migrations/1784550000000-scope-crm-opportunity-uniqueness-to-open';
import { HardenCrmOpportunityLifecycle1784560000000 } from './migrations/1784560000000-harden-crm-opportunity-lifecycle';
import { AddDeterministicCrmRouting1784570000000 } from './migrations/1784570000000-add-deterministic-crm-routing';
import { CreateGovernedStageTransitions1784580000000 } from './migrations/1784580000000-create-governed-stage-transitions';
import { AddCrmOpportunityLineage1784590000000 } from './migrations/1784590000000-add-crm-opportunity-lineage';
import { AddLeadflowAutomationTemplateVersion1785000000000 } from './migrations/1785000000000-add-leadflow-automation-template-version';
import { CreateLeadflowAutomationRuns1785500000000 } from './migrations/1785500000000-create-leadflow-automation-runs';
import { AddLeadflowAutomationExecutionPermission1785600000000 } from './migrations/1785600000000-add-leadflow-automation-execution-permission';
import { CreateLeadflowEventDeliveries1785700000000 } from './migrations/1785700000000-create-leadflow-event-deliveries';
import { ExpandTaskChecklistItemTitle1786100000000 } from './migrations/1786100000000-expand-task-checklist-item-title';
// Agency-app migrations that were created but left unregistered here (they run
// against the agency database — finance/CRM/LeadFlow); registering them so
// `agency:migration:run` actually applies them. All are idempotent (IF NOT EXISTS).
import { AddFinanceBillTeamPaymentOccurrenceIndex1782900000000 } from './migrations/1782900000000-add-finance-bill-team-payment-occurrence-index';
import { CreateCrmLeadScore1786000000000 } from './migrations/1786000000000-create-crm-lead-score';
import { FanoutLeadScoreConsumer1786500000000 } from './migrations/1786500000000-fanout-lead-score-consumer';
import { AddCrmOpportunityAutonomyMode1786600000000 } from './migrations/1786600000000-add-crm-opportunity-autonomy-mode';
import { AddCrmStageRole1786700000000 } from './migrations/1786700000000-add-crm-stage-role';
import { CreatePlatformWhatsAppNotificationDeliveries1786800000000 } from './migrations/1786800000000-create-platform-whatsapp-notification-deliveries';
import { AddProjectCardDisplayDefaults1786900000000 } from './migrations/1786900000000-add-project-card-display-defaults';
import { CreateLeadflowScheduledTimers1787000000000 } from './migrations/1787000000000-create-leadflow-scheduled-timers';
import { CreatePlatformAdminIdentityAccess1787100000000 } from './migrations/1787100000000-create-platform-admin-identity-access';
import { CreatePlatformAdminSessions1787200000000 } from './migrations/1787200000000-create-platform-admin-sessions';
import { AddPlatformAdminPreferenceFormats1787300000000 } from './migrations/1787300000000-add-platform-admin-preference-formats';
import { CreatePlatformAdminInvitations1787400000000 } from './migrations/1787400000000-create-platform-admin-invitations';
import { CreatePlatformAdminIdentities1787500000000 } from './migrations/1787500000000-create-platform-admin-identities';
import { AddPlatformAdminProfileFields1787700000000 } from './migrations/1787700000000-add-platform-admin-profile-fields';
import { FanoutLeadflowAnalyticsConsumer1787800000000 } from './migrations/1787800000000-fanout-leadflow-analytics-consumer';
import { CreateLeadflowCsatResponses1787900000000 } from './migrations/1787900000000-create-leadflow-csat-responses';
import { CreateLeadflowAppointmentsCore1788000000000 } from './migrations/1788000000000-create-leadflow-appointments-core';
import { CreateLeadflowIntelligenceLayer1788100000000 } from './migrations/1788100000000-create-leadflow-intelligence-layer';
import { CreateLeadflowPrivacyTelemetry1788200000000 } from './migrations/1788200000000-create-leadflow-privacy-telemetry';
import { RefineFinanceBillsAndBankAvatars1788300000000 } from './migrations/1788300000000-refine-finance-bills-and-bank-avatars';
import { CreateFinanceBankTransfers1788400000000 } from './migrations/1788400000000-create-finance-bank-transfers';
import { CreateLeadflowBriefingProvenance1788500000000 } from './migrations/1788500000000-create-leadflow-briefing-provenance';
import { AddLeadflowBriefingPermissions1788600000000 } from './migrations/1788600000000-add-leadflow-briefing-permissions';
import { CreateLeadflowAutomationGlobalConfigVersions1788700000000 } from './migrations/1788700000000-create-leadflow-automation-global-config-versions';
import { AddLeadflowAgentsLifecycle1788800000000 } from './migrations/1788800000000-add-leadflow-agents-lifecycle';
import { CreateLeadflowAnalyticsViews1788900000000 } from './migrations/1788900000000-create-leadflow-analytics-views';
import { AddLeadflowAnalyticsWidgetLayout1789000000000 } from './migrations/1789000000000-add-leadflow-analytics-widget-layout';
import { ReconcileLeadflowBriefingFullSchema1789050000000 } from './migrations/1789050000000-reconcile-leadflow-briefing-full-schema';
import { ReconcileLeadflowBriefingReviewSchema1789100000000 } from './migrations/1789100000000-reconcile-leadflow-briefing-review-schema';
import { CreateLeadflowOperationsActions1789300000000 } from './migrations/1789300000000-create-leadflow-operations-actions';
import { AddUserProfileWhatsapp1789400000000 } from './migrations/1789400000000-add-user-profile-whatsapp';
import { BackfillLeadDistributionNotificationChannels1789500000000 } from './migrations/1789500000000-backfill-lead-distribution-notification-channels';
import { BackfillOpportunityFollowMode1789600000000 } from './migrations/1789600000000-backfill-opportunity-follow-mode';
import { RemoveRetiredAutomationRecipes1789700000000 } from './migrations/1789700000000-remove-retired-automation-recipes';
import { TagRulesForAutomaticTagging1789800000000 } from './migrations/1789800000000-tag-rules-for-automatic-tagging';
import { OutsideHoursAnswersDuringHandoff1789900000000 } from './migrations/1789900000000-outside-hours-answers-during-handoff';
import { CreateLeadflowWebhookDeliveries1790000000000 } from './migrations/1790000000000-create-leadflow-webhook-deliveries';
import { FanoutLeadflowWebhooksConsumer1790100000000 } from './migrations/1790100000000-fanout-leadflow-webhooks-consumer';
import { CreateSocialAdAccountConnections1790200000000 } from './migrations/1790200000000-create-social-ad-account-connections';
import { AddSocialAdAuthorizationMethod1790300000000 } from './migrations/1790300000000-add-social-ad-authorization-method';
import { CreateSocialAdReadModel1790400000000 } from './migrations/1790400000000-create-social-ad-read-model';
import { CreateInboxAttributionObservations1790500000000 } from './migrations/1790500000000-create-inbox-attribution-observations';
import { AddSocialAdDestination1790600000000 } from './migrations/1790600000000-add-social-ad-destination';
import { CreateSocialAdDestinationObservations1790700000000 } from './migrations/1790700000000-create-social-ad-destination-observations';

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
    CreateInboxCore1760000020000,
    CreateInboxSettings1760000021000,
    ExpandInboxChannelsFoundation1760000024000,
    CreateInboxWebhookLogs1760000025000,
    CreateInboxChannelConnectionSessions1760000026000,
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
    ReconcileAgencyTeamConfigOptionsSchema1760002031500,
    CreateAgencyTeamAttendance1760002026000,
    FixTeamConfigOptionsSeniorityUniqueIndex1760002032000,
    AddProjectIdToTaskStages1760002036000,
    AddProjectFollowersAndAttachments1760002037000,
    AddTaskTypeFields1760002040000,
    CreateAgencyClientsCore1760002041000,
    CreateAgencyKnowledgeCore1760002042000,
    CreateAgencyKnowledgeQuickNotes1760002042500,
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
    CreateLeadflowAutomationsCore1783600000000,
    AddLeadflowAutomationsPermissions1783700000000,
    AddLeadflowEventsPermissions1783800000000,
    CreateLeadflowOperationsRoom1783900000000,
    AddOperationsRoomOutboxDelivery1784000000000,
    CreateLeadflowInboxRuntime1784100000000,
    HardenInboxSupervisedRuntime1784200000000,
    CreateInboxProviderUsageLedger1784300000000,
    PrepareLeadflowAgencyPilot1784400000000,
    AddInboxDecisionReviewOutcomes1784500000000,
    EnforceDefaultAgentBindingInvariant1784510000000,
    AddInboxOutboxLifecycle1784520000000,
    HardenInboxAssistedMode1784530000000,
    CreateInboxGovernedActions1784540000000,
    ScopeCrmOpportunityUniquenessToOpen1784550000000,
    HardenCrmOpportunityLifecycle1784560000000,
    AddDeterministicCrmRouting1784570000000,
    CreateGovernedStageTransitions1784580000000,
    AddCrmOpportunityLineage1784590000000,
    AddLeadflowAutomationTemplateVersion1785000000000,
    CreateLeadflowAutomationRuns1785500000000,
    AddLeadflowAutomationExecutionPermission1785600000000,
    CreateLeadflowEventDeliveries1785700000000,
    ExpandTaskChecklistItemTitle1786100000000,
    AddFinanceBillTeamPaymentOccurrenceIndex1782900000000,
    CreateCrmLeadScore1786000000000,
    FanoutLeadScoreConsumer1786500000000,
    AddCrmOpportunityAutonomyMode1786600000000,
    AddCrmStageRole1786700000000,
    CreatePlatformWhatsAppNotificationDeliveries1786800000000,
    AddProjectCardDisplayDefaults1786900000000,
    CreateLeadflowScheduledTimers1787000000000,
    CreatePlatformAdminIdentityAccess1787100000000,
    CreatePlatformAdminSessions1787200000000,
    AddPlatformAdminPreferenceFormats1787300000000,
    CreatePlatformAdminInvitations1787400000000,
    CreatePlatformAdminIdentities1787500000000,
    AddPlatformAdminProfileFields1787700000000,
    FanoutLeadflowAnalyticsConsumer1787800000000,
    CreateLeadflowCsatResponses1787900000000,
    CreateLeadflowAppointmentsCore1788000000000,
    CreateLeadflowIntelligenceLayer1788100000000,
    CreateLeadflowPrivacyTelemetry1788200000000,
    RefineFinanceBillsAndBankAvatars1788300000000,
    CreateFinanceBankTransfers1788400000000,
    CreateLeadflowBriefingProvenance1788500000000,
    AddLeadflowBriefingPermissions1788600000000,
    CreateLeadflowAutomationGlobalConfigVersions1788700000000,
    AddLeadflowAgentsLifecycle1788800000000,
    CreateLeadflowAnalyticsViews1788900000000,
    AddLeadflowAnalyticsWidgetLayout1789000000000,
    ReconcileLeadflowBriefingFullSchema1789050000000,
    ReconcileLeadflowBriefingReviewSchema1789100000000,
    CreateLeadflowOperationsActions1789300000000,
    AddUserProfileWhatsapp1789400000000,
    BackfillLeadDistributionNotificationChannels1789500000000,
    BackfillOpportunityFollowMode1789600000000,
    RemoveRetiredAutomationRecipes1789700000000,
    TagRulesForAutomaticTagging1789800000000,
    OutsideHoursAnswersDuringHandoff1789900000000,
    CreateLeadflowWebhookDeliveries1790000000000,
    FanoutLeadflowWebhooksConsumer1790100000000,
    CreateSocialAdAccountConnections1790200000000,
    AddSocialAdAuthorizationMethod1790300000000,
    CreateSocialAdReadModel1790400000000,
    CreateInboxAttributionObservations1790500000000,
    AddSocialAdDestination1790600000000,
    CreateSocialAdDestinationObservations1790700000000,
  ],
});
