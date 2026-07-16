import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { PermissionsModule } from '../permissions';
import { AgencyUserSessionEntity } from '../agency/entities/agency-auth.entities';
import { AgencyWorkspaceUserEntity } from '../agency/entities/agency-settings.entities';
import {
  LeadFlowAgentChannelBindingEntity,
  LeadFlowAgentEntity,
  LeadFlowAgentVersionEntity,
  LeadFlowAgentOperationalStateEntity,
  OperationsRoomRevisionEntity,
  OperationsRoomOutboxEntity,
} from './entities';
import { LeadFlowAgentsController } from './leadflow-agents.controller';
import { LeadFlowAgentPresetService } from './services/leadflow-agent-preset.service';
import { LeadFlowAgentRuntimeConfigService } from './services/leadflow-agent-runtime-config.service';
import { LeadFlowAgentService } from './services/leadflow-agent.service';
import { OperationsRoomStateService } from './services/operations-room-state.service';
import { OperationsRoomEventBusService } from './realtime/operations-room-event-bus.service';
import { OperationsRoomGateway } from './realtime/operations-room.gateway';
import { OperationsRoomOutboxWorker } from './realtime/operations-room-outbox.worker';
import { OperationsRoomRealtimeHealthService } from './realtime/operations-room-realtime-health.service';
import { OperationsRoomRealtimeMetrics } from './realtime/operations-room-realtime.metrics';

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
        OperationsRoomRevisionEntity,
        OperationsRoomOutboxEntity,
        AgencyUserSessionEntity,
        AgencyWorkspaceUserEntity,
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowAgentsController],
  providers: [
    LeadFlowAgentService,
    LeadFlowAgentPresetService,
    LeadFlowAgentRuntimeConfigService,
    OperationsRoomStateService,
    OperationsRoomEventBusService,
    OperationsRoomOutboxWorker,
    OperationsRoomRealtimeMetrics,
    OperationsRoomRealtimeHealthService,
    OperationsRoomGateway,
  ],
  exports: [
    LeadFlowAgentService,
    LeadFlowAgentRuntimeConfigService,
    OperationsRoomStateService,
    OperationsRoomRealtimeHealthService,
  ],
})
export class LeadFlowAgentsModule {}
