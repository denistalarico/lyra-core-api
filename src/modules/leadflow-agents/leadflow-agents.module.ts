import { CompanyProductsModule } from '../../common/company-products/company-products.module';
import { LeadFlowAgentsCompanyProductParticipant } from './leadflow-agents-company-product.participant';
import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { PermissionsModule } from '../permissions';
import { AgencyContactsModule } from '../agency/agency-contacts.module';
import { CrmModule } from '../crm/crm.module';
import { LeadFlowAgendaModule } from '../leadflow-agenda/leadflow-agenda.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeadFlowAgentPauseResumeService } from './services/leadflow-agent-pause-resume.service';
import { LeadFlowOperationsActionAccessService } from './services/leadflow-operations-action-access.service';
import { LeadFlowOperationsActionExecutorService } from './services/leadflow-operations-action-executor.service';
import { AgencyUserSessionEntity } from '../agency/entities/agency-auth.entities';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../agency/entities/agency-settings.entities';
import {
  LeadFlowAgentChannelBindingEntity,
  LeadFlowAgentEntity,
  LeadFlowAgentVersionEntity,
  LeadFlowAgentOperationalStateEntity,
  LeadFlowOperationsActionEntity,
  LeadFlowOperationsActionEventEntity,
  OperationsRoomRevisionEntity,
  OperationsRoomOutboxEntity,
} from './entities';
import { LeadFlowAgentsController } from './leadflow-agents.controller';
import { LeadFlowAgentPresetService } from './services/leadflow-agent-preset.service';
import { LeadFlowAgentRuntimeConfigService } from './services/leadflow-agent-runtime-config.service';
import { LeadFlowAgentService } from './services/leadflow-agent.service';
import { LeadFlowAgentBindingReconcilerService } from './services/leadflow-agent-binding-reconciler.service';
import { InboxChannelEntity } from '../inbox/entities/inbox-channel.entity';
import { InboxConversationEntity } from '../inbox/entities/inbox-conversation.entity';
import { InboxDomainOutboxEntity } from '../inbox/entities/inbox-domain-outbox.entity';
import { AgencyClientCompanyContext } from '../clients/entities/agency-client-company-context.entity';
import { OperationsRoomStateService } from './services/operations-room-state.service';
import { OperationsRoomEventBusService } from './realtime/operations-room-event-bus.service';
import { OperationsRoomGateway } from './realtime/operations-room.gateway';
import { OperationsRoomOutboxWorker } from './realtime/operations-room-outbox.worker';
import { OperationsRoomRealtimeHealthService } from './realtime/operations-room-realtime-health.service';
import { OperationsRoomRealtimeMetrics } from './realtime/operations-room-realtime.metrics';
import { LeadFlowOperationsActionService } from './services/leadflow-operations-action.service';

@Module({
  imports: [
    CompanyProductsModule,
    JwtModule.register({}),
    PermissionsModule,
    // OR5: confirmed room proposals run through these domain services. The
    // agenda module reaches back here through appointments → team chat →
    // Orion, hence the forward reference.
    CrmModule,
    AgencyContactsModule,
    forwardRef(() => LeadFlowAgendaModule),
    NotificationsModule,
    TypeOrmModule.forFeature(
      [
        LeadFlowAgentEntity,
        LeadFlowAgentVersionEntity,
        LeadFlowAgentChannelBindingEntity,
        LeadFlowClientSettingsEntity,
        LeadFlowAgentOperationalStateEntity,
        LeadFlowOperationsActionEntity,
        LeadFlowOperationsActionEventEntity,
        OperationsRoomRevisionEntity,
        OperationsRoomOutboxEntity,
        AgencyUserSessionEntity,
        AgencyWorkspaceUserEntity,
        AgencyUserProfileEntity,
        InboxChannelEntity,
        InboxConversationEntity,
        InboxDomainOutboxEntity,
        AgencyClientCompanyContext,
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowAgentsController],
  providers: [
    LeadFlowAgentsCompanyProductParticipant,
    LeadFlowAgentService,
    LeadFlowAgentBindingReconcilerService,
    LeadFlowAgentPresetService,
    LeadFlowAgentRuntimeConfigService,
    OperationsRoomStateService,
    OperationsRoomEventBusService,
    OperationsRoomOutboxWorker,
    OperationsRoomRealtimeMetrics,
    OperationsRoomRealtimeHealthService,
    LeadFlowOperationsActionService,
    LeadFlowOperationsActionAccessService,
    LeadFlowOperationsActionExecutorService,
    LeadFlowAgentPauseResumeService,
    OperationsRoomGateway,
  ],
  exports: [
    LeadFlowAgentService,
    LeadFlowAgentBindingReconcilerService,
    LeadFlowAgentRuntimeConfigService,
    OperationsRoomStateService,
    OperationsRoomRealtimeHealthService,
    // OR3: the Client Area Operations Room gateway shares the same bus.
    OperationsRoomEventBusService,
    // OR5: the Orion proposes through the same service and access check.
    LeadFlowOperationsActionService,
    LeadFlowOperationsActionAccessService,
  ],
})
export class LeadFlowAgentsModule {}
