import type { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { getRecipeByKey } from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationEntity } from '../entities';
import type { LeadFlowAutomationGlobalDefaultsSnapshot } from '../types/leadflow-automation.types';
import { LeadFlowAutomationConfigSchemaService } from './leadflow-automation-config-schema.service';
import {
  DEFAULT_LEADFLOW_AUTOMATION_GLOBAL_DEFAULTS,
  resolveLeadFlowAutomationEffectiveConfig,
} from './leadflow-automation-global-config.service';
import {
  clearInheritedConfigFields,
  LeadFlowAutomationService,
} from './leadflow-automation.service';

describe('LeadFlowAutomationService effective configuration', () => {
  it('does not report inherited required values as missing', async () => {
    const recipe = getRecipeByKey('followup_idle_lead');
    expect(recipe).toBeDefined();
    if (!recipe) return;

    const snapshot: LeadFlowAutomationGlobalDefaultsSnapshot = {
      version: 0,
      source: 'fallback',
      createdAt: null,
      config: DEFAULT_LEADFLOW_AUTOMATION_GLOBAL_DEFAULTS,
    };
    const globalConfigService = {
      getCurrent: jest.fn().mockResolvedValue(snapshot),
      resolve: resolveLeadFlowAutomationEffectiveConfig,
    };
    const dependencies = Array.from({ length: 17 }, () => ({}));
    dependencies[7] = globalConfigService;
    dependencies[8] = new LeadFlowAutomationConfigSchemaService();
    const service = Reflect.construct(
      LeadFlowAutomationService,
      dependencies,
    ) as LeadFlowAutomationService;

    const automation = {
      triggerConfig: clearInheritedConfigFields(
        'trigger',
        recipe.defaultTriggerConfig,
      ),
      conditionConfig: clearInheritedConfigFields(
        'conditions',
        recipe.defaultConditionConfig,
      ),
      actionConfig: clearInheritedConfigFields(
        'actions',
        recipe.defaultActionConfig,
      ),
      messageConfig: clearInheritedConfigFields(
        'message',
        recipe.defaultMessageConfig,
      ),
      crmPolicy: recipe.defaultCrmPolicy,
      schedulePolicy: clearInheritedConfigFields(
        'schedulePolicy',
        recipe.defaultSchedulePolicy,
      ),
    } as LeadFlowAutomationEntity;
    expect(automation.triggerConfig.delayHours).toBeNull();
    expect(automation.actionConfig.maxAttempts).toBeNull();

    const subject = service as unknown as {
      findMissingEffectiveConfiguration(
        automation: LeadFlowAutomationEntity,
        active: { settings: LeadFlowClientSettingsEntity },
        selectedRecipe: typeof recipe,
      ): Promise<string[]>;
    };
    const missing = await subject.findMissingEffectiveConfiguration(
      automation,
      { settings: {} as LeadFlowClientSettingsEntity },
      recipe,
    );

    expect(globalConfigService.getCurrent).toHaveBeenCalledTimes(1);
    expect(missing).not.toContain('trigger.delayHours');
    expect(missing).not.toContain('actions.maxAttempts');
  });
});
