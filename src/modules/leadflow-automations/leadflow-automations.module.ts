import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { PermissionsModule } from '../permissions';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationVersionEntity,
} from './entities';
import { LeadFlowAutomationsController } from './leadflow-automations.controller';
import { LeadFlowAutomationConfigSchemaService } from './services/leadflow-automation-config-schema.service';
import { LeadFlowAutomationLifecycleService } from './services/leadflow-automation-lifecycle.service';
import { LeadFlowAutomationRecipeService } from './services/leadflow-automation-recipe.service';
import { LeadFlowAutomationRuntimeConfigService } from './services/leadflow-automation-runtime-config.service';
import { LeadFlowAutomationService } from './services/leadflow-automation.service';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        LeadFlowAutomationEntity,
        LeadFlowAutomationVersionEntity,
        LeadFlowClientSettingsEntity,
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowAutomationsController],
  providers: [
    LeadFlowAutomationService,
    LeadFlowAutomationRecipeService,
    LeadFlowAutomationRuntimeConfigService,
    LeadFlowAutomationConfigSchemaService,
    LeadFlowAutomationLifecycleService,
  ],
  exports: [LeadFlowAutomationService, LeadFlowAutomationRuntimeConfigService],
})
export class LeadFlowAutomationsModule {}
