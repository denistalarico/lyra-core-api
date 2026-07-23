import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { PermissionsModule } from '../permissions';
import { CrmModule } from '../crm/crm.module';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationRunAttemptEntity,
  LeadFlowAutomationRunEntity,
  LeadFlowAutomationVersionEntity,
} from './entities';
import { LeadFlowAutomationsController } from './leadflow-automations.controller';
import { LeadFlowAutomationConfigSchemaService } from './services/leadflow-automation-config-schema.service';
import { LeadFlowAutomationCrmActionService } from './services/leadflow-automation-crm-action.service';
import { LeadFlowAutomationEvaluationService } from './services/leadflow-automation-evaluation.service';
import { LeadFlowAutomationLifecycleService } from './services/leadflow-automation-lifecycle.service';
import { LeadFlowAutomationRecipeService } from './services/leadflow-automation-recipe.service';
import { LeadFlowAutomationRunService } from './services/leadflow-automation-run.service';
import { LeadFlowAutomationRuntimeConfigService } from './services/leadflow-automation-runtime-config.service';
import { LeadFlowAutomationService } from './services/leadflow-automation.service';

@Module({
  imports: [
    PermissionsModule,
    CrmModule,
    TypeOrmModule.forFeature(
      [
        LeadFlowAutomationEntity,
        LeadFlowAutomationVersionEntity,
        LeadFlowAutomationRunEntity,
        LeadFlowAutomationRunAttemptEntity,
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
    LeadFlowAutomationEvaluationService,
    LeadFlowAutomationRunService,
    LeadFlowAutomationCrmActionService,
  ],
  exports: [
    LeadFlowAutomationService,
    LeadFlowAutomationRuntimeConfigService,
    LeadFlowAutomationCrmActionService,
  ],
})
export class LeadFlowAutomationsModule {}
