import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { PermissionsModule } from '../permissions';
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
import { OperationsRoomStateService } from './services/operations-room-state.service';
import { OperationsRoomEventBusService } from './realtime/operations-room-event-bus.service';
import { OperationsRoomGateway } from './realtime/operations-room.gateway';
import { OperationsRoomOutboxWorker } from './realtime/operations-room-outbox.worker';
import { OperationsRoomRealtimeHealthService } from './realtime/operations-room-realtime-health.service';
import { OperationsRoomRealtimeMetrics } from './realtime/operations-room-realtime.metrics';
import { LeadFlowOperationsActionService } from './services/leadflow-operations-action.service';

@Module({
  imports: [
    JwtModule.register({}),
    PermissionsModule,
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
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowAgentsController],
  providers: [
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
    OperationsRoomGateway,
  ],
  exports: [
    LeadFlowAgentService,
    LeadFlowAgentBindingReconcilerService,
    LeadFlowAgentRuntimeConfigService,
    OperationsRoomStateService,
    OperationsRoomRealtimeHealthService,
  ],
})
export class LeadFlowAgentsModule {}
