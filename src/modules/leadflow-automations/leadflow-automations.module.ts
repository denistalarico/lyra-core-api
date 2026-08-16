import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { PermissionsModule } from '../permissions';
import { CrmModule } from '../crm/crm.module';
import { InboxModule } from '../inbox/inbox.module';
import { NotificationsModule } from '../notifications';
import { LeadFlowAnalyticsModule } from '../leadflow-analytics/leadflow-analytics.module';
import { InboxDomainOutboxEntity } from '../inbox/entities/inbox-domain-outbox.entity';
import { InboxChannelEntity } from '../inbox/entities/inbox-channel.entity';
import { LeadFlowEventDeliveryEntity } from '../leadflow-events/entities';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationGlobalConfigVersionEntity,
  LeadFlowAutomationRunAttemptEntity,
  LeadFlowAutomationRunEntity,
  LeadFlowScheduledTimerEntity,
  LeadFlowAutomationVersionEntity,
  LeadFlowWebhookDeliveryEntity,
} from './entities';
import { LeadFlowWebhookAdminService } from './webhooks/leadflow-webhook-admin.service';
import { LeadFlowWebhookDispatcherService } from './webhooks/leadflow-webhook-dispatcher.service';
import { LeadFlowWebhookEventIngressService } from './webhooks/leadflow-webhook-event-ingress.service';
import { LeadFlowWebhookGate } from './webhooks/leadflow-webhook-gate.service';
import { LeadFlowAutomationsController } from './leadflow-automations.controller';
import { LeadFlowAutomationConfigSchemaService } from './services/leadflow-automation-config-schema.service';
import { LeadFlowAutomationCrmActionService } from './services/leadflow-automation-crm-action.service';
import { LeadFlowAutomationContextService } from './services/leadflow-automation-context.service';
import {
  LeadFlowAutomationContextLoaderService,
  LEADFLOW_CONTEXT_LOADER_ENTITIES,
} from './services/leadflow-automation-context-loader.service';
import { LeadFlowAutomationEvaluationService } from './services/leadflow-automation-evaluation.service';
import { LeadFlowAutomationExecutionGate } from './services/leadflow-automation-execution-gate.service';
import { LeadFlowAutomationExecutionService } from './services/leadflow-automation-execution.service';
import { MoveOpportunityStageExecutor } from './executors/move-opportunity-stage.executor';
import { AssignOpportunityOwnerExecutor } from './executors/assign-opportunity-owner.executor';
import { RequestHandoffExecutor } from './executors/request-handoff.executor';
import { NotifyUserExecutor } from './executors/notify-user.executor';
import { ScheduleFollowupExecutor } from './executors/schedule-followup.executor';
import { ScheduleAppointmentReminderExecutor } from './executors/schedule-appointment-reminder.executor';
import { SendMessageExecutor } from './executors/send-message.executor';
import { AddOpportunityTagExecutor } from './executors/add-opportunity-tag.executor';
import { RequestCsatExecutor } from './executors/request-csat.executor';
import { GenerateDailySummaryExecutor } from './executors/generate-daily-summary.executor';
import { LeadFlowAutomationNotificationPublisher } from './services/leadflow-automation-notification.publisher';
import { LeadFlowAutomationEventIngressService } from './services/leadflow-automation-event-ingress.service';
import { LeadFlowAutomationLifecycleService } from './services/leadflow-automation-lifecycle.service';
import { LeadFlowAutomationRecipeService } from './services/leadflow-automation-recipe.service';
import { LeadFlowAutomationRunService } from './services/leadflow-automation-run.service';
import { LeadFlowAutomationShadowEvaluatorService } from './services/leadflow-automation-shadow-evaluator.service';
import { LeadFlowAutomationTriggerMatcherService } from './services/leadflow-automation-trigger-matcher.service';
import { LeadFlowAutomationRuntimeConfigService } from './services/leadflow-automation-runtime-config.service';
import { LeadFlowAutomationGlobalConfigService } from './services/leadflow-automation-global-config.service';
import { LeadFlowAutomationService } from './services/leadflow-automation.service';
import {
  PostgresSchedulerRuntime,
  SCHEDULER_RUNTIME,
  ScheduledTimerConsumerRegistry,
} from './scheduler';
import { LeadFlowFollowupTimerConsumer } from './services/leadflow-followup-timer.consumer';
import { LeadFlowAppointmentTimerConsumer } from './services/leadflow-appointment-timer.consumer';
import { LeadFlowFollowupIdleDetectorService } from './services/leadflow-followup-idle-detector.service';
import { LeadFlowBusinessHoursClosedDetectorService } from './services/leadflow-business-hours-closed-detector.service';
import { LeadFlowWorkspaceBusinessHoursService } from './services/leadflow-workspace-business-hours.service';
import { InboxSettingsEntity } from '../inbox/entities/inbox-settings.entity';
import {
  AgencyUserProfileEntity,
  AgencyUserNotificationPreferencesEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceEmailSettingsEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from '../agency/entities/agency-settings.entities';
import { CrmPipelineEntity } from '../crm/entities/crm-pipeline.entity';
import { NotificationRecipientEntity } from '../notifications/entities';
import { PlatformWhatsAppNotificationModule } from '../notifications/platform-whatsapp/platform-whatsapp-notification.module';
import { LeadFlowCsatExpiryTimerConsumer } from './services/leadflow-csat-expiry-timer.consumer';
import { LeadFlowDailySummaryTimerConsumer } from './services/leadflow-daily-summary-timer.consumer';
import { LeadFlowDailySummarySchedulerService } from './services/leadflow-daily-summary-scheduler.service';
import { AppointmentsModule } from '../appointments/appointments.module';
import { TeamChatModule } from '../team-chat/team-chat.module';
import { LeadFlowAppointmentMessageService } from './services/leadflow-appointment-message.service';
import { LeadFlowSummaryAgentResolver } from './services/leadflow-summary-agent.resolver';
import { LeadFlowTeamChatDeliveryService } from './services/leadflow-team-chat-delivery.service';
import { LeadFlowAppointmentLifecycleSchedulerService } from './services/leadflow-appointment-lifecycle-scheduler.service';

@Module({
  imports: [
    PermissionsModule,
    CrmModule,
    InboxModule,
    NotificationsModule,
    LeadFlowAnalyticsModule,
    AppointmentsModule,
    TeamChatModule,
    PlatformWhatsAppNotificationModule,
    TypeOrmModule.forFeature(
      [
        LeadFlowAutomationEntity,
        LeadFlowAutomationGlobalConfigVersionEntity,
        LeadFlowAutomationVersionEntity,
        LeadFlowAutomationRunEntity,
        LeadFlowAutomationRunAttemptEntity,
        LeadFlowClientSettingsEntity,
        LeadFlowEventDeliveryEntity,
        LeadFlowScheduledTimerEntity,
        LeadFlowWebhookDeliveryEntity,
        InboxDomainOutboxEntity,
        InboxSettingsEntity,
        CrmPipelineEntity,
        AgencyWorkspaceUserEntity,
        AgencyWorkspaceUserPermissionEntity,
        AgencyUserProfileEntity,
        AgencyUserNotificationPreferencesEntity,
        AgencyWorkspaceCompanySettingsEntity,
        AgencyWorkspaceEmailSettingsEntity,
        NotificationRecipientEntity,
        InboxChannelEntity,
        ...LEADFLOW_CONTEXT_LOADER_ENTITIES,
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowAutomationsController],
  providers: [
    LeadFlowAutomationService,
    LeadFlowAutomationRecipeService,
    LeadFlowAutomationRuntimeConfigService,
    LeadFlowAutomationGlobalConfigService,
    LeadFlowAutomationConfigSchemaService,
    LeadFlowAutomationLifecycleService,
    LeadFlowAutomationContextService,
    LeadFlowAutomationContextLoaderService,
    LeadFlowAutomationEvaluationService,
    LeadFlowAutomationExecutionGate,
    LeadFlowAutomationExecutionService,
    MoveOpportunityStageExecutor,
    AssignOpportunityOwnerExecutor,
    RequestHandoffExecutor,
    NotifyUserExecutor,
    ScheduleFollowupExecutor,
    ScheduleAppointmentReminderExecutor,
    SendMessageExecutor,
    AddOpportunityTagExecutor,
    RequestCsatExecutor,
    GenerateDailySummaryExecutor,
    ScheduledTimerConsumerRegistry,
    PostgresSchedulerRuntime,
    {
      provide: SCHEDULER_RUNTIME,
      useExisting: PostgresSchedulerRuntime,
    },
    LeadFlowFollowupTimerConsumer,
    LeadFlowAppointmentTimerConsumer,
    LeadFlowAppointmentLifecycleSchedulerService,
    LeadFlowCsatExpiryTimerConsumer,
    LeadFlowDailySummaryTimerConsumer,
    LeadFlowDailySummarySchedulerService,
    LeadFlowAppointmentMessageService,
    LeadFlowSummaryAgentResolver,
    LeadFlowTeamChatDeliveryService,
    LeadFlowFollowupIdleDetectorService,
    LeadFlowBusinessHoursClosedDetectorService,
    LeadFlowWorkspaceBusinessHoursService,
    LeadFlowAutomationNotificationPublisher,
    LeadFlowAutomationEventIngressService,
    LeadFlowAutomationRunService,
    LeadFlowAutomationShadowEvaluatorService,
    LeadFlowAutomationTriggerMatcherService,
    LeadFlowAutomationCrmActionService,
    LeadFlowWebhookGate,
    LeadFlowWebhookDispatcherService,
    LeadFlowWebhookEventIngressService,
    LeadFlowWebhookAdminService,
  ],
  exports: [
    LeadFlowAutomationService,
    LeadFlowAutomationRuntimeConfigService,
    LeadFlowAutomationCrmActionService,
  ],
})
export class LeadFlowAutomationsModule {}
