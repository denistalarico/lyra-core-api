import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { PermissionsModule } from '../permissions';
import {
  LeadFlowAgentChannelBindingEntity,
  LeadFlowAgentEntity,
  LeadFlowAgentVersionEntity,
} from './entities';
import { LeadFlowAgentsController } from './leadflow-agents.controller';
import { LeadFlowAgentPresetService } from './services/leadflow-agent-preset.service';
import { LeadFlowAgentRuntimeConfigService } from './services/leadflow-agent-runtime-config.service';
import { LeadFlowAgentService } from './services/leadflow-agent.service';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        LeadFlowAgentEntity,
        LeadFlowAgentVersionEntity,
        LeadFlowAgentChannelBindingEntity,
        LeadFlowClientSettingsEntity,
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowAgentsController],
  providers: [
    LeadFlowAgentService,
    LeadFlowAgentPresetService,
    LeadFlowAgentRuntimeConfigService,
  ],
  exports: [LeadFlowAgentService, LeadFlowAgentRuntimeConfigService],
})
export class LeadFlowAgentsModule {}
