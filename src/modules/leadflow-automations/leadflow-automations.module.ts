import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeadFlowClientSettingsEntity } from '../leadflow-settings/entities';
import { PermissionsModule } from '../permissions';
import { CrmModule } from '../crm/crm.module';
import { LeadFlowEventDeliveryEntity } from '../leadflow-events/entities';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationRunAttemptEntity,
  LeadFlowAutomationRunEntity,
  LeadFlowAutomationVersionEntity,
} from './entities';
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
import { LeadFlowAutomationEventIngressService } from './services/leadflow-automation-event-ingress.service';
import { LeadFlowAutomationLifecycleService } from './services/leadflow-automation-lifecycle.service';
import { LeadFlowAutomationRecipeService } from './services/leadflow-automation-recipe.service';
import { LeadFlowAutomationRunService } from './services/leadflow-automation-run.service';
import { LeadFlowAutomationShadowEvaluatorService } from './services/leadflow-automation-shadow-evaluator.service';
import { LeadFlowAutomationTriggerMatcherService } from './services/leadflow-automation-trigger-matcher.service';
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
        LeadFlowEventDeliveryEntity,
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
    LeadFlowAutomationConfigSchemaService,
    LeadFlowAutomationLifecycleService,
    LeadFlowAutomationContextService,
    LeadFlowAutomationContextLoaderService,
    LeadFlowAutomationEvaluationService,
    LeadFlowAutomationExecutionGate,
    LeadFlowAutomationExecutionService,
    MoveOpportunityStageExecutor,
    LeadFlowAutomationEventIngressService,
    LeadFlowAutomationRunService,
    LeadFlowAutomationShadowEvaluatorService,
    LeadFlowAutomationTriggerMatcherService,
    LeadFlowAutomationCrmActionService,
  ],
  exports: [
    LeadFlowAutomationService,
    LeadFlowAutomationRuntimeConfigService,
    LeadFlowAutomationCrmActionService,
  ],
})
export class LeadFlowAutomationsModule {}
