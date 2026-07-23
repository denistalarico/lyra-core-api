import {
  findUnmetDependencies,
  type LeadFlowAutomationUnmetDependency,
} from '../catalog/automation-dependencies.registry';
import {
  isRecipeCompatible,
  type LeadFlowAutomationRecipeCatalogItem,
  type LeadFlowAutomationTriggerKind,
} from '../catalog/automation-recipes.catalog';
import { LeadFlowAutomationCategory } from '../enums/leadflow-automation-category.enum';
import {
  unavailableExecutors,
  type AutomationExecutorAvailability,
} from '../executors';

export interface LeadFlowAutomationRecipeResponse {
  key: string;
  name: string;
  description: string;
  category: LeadFlowAutomationCategory;
  tier: string;
  templateVersion: number;
  deprecated: boolean;
  trigger: string;
  /** How the trigger actually arrives: event, derived, schedule or webhook. */
  triggerKind: LeadFlowAutomationTriggerKind;
  primaryAction: string;
  whenLabel: string;
  limitsLabel: string;
  isDeveloperOnly: boolean;
  requiresApps: string[];
  businessModeKeys: string[] | 'all';
  compatibleWithBusinessMode: boolean;
  /**
   * Platform capabilities still missing for this recipe. Non-empty means the
   * recipe can be provisioned and configured, but never switched on yet.
   */
  unmetDependencies: LeadFlowAutomationUnmetDependency[];
  unavailableActions: AutomationExecutorAvailability[];
  safetyRules: string[];
}

export interface LeadFlowAutomationRecipeListResponse {
  businessModeKey: string;
  isCustomBusinessMode: boolean;
  runtimeAvailable: boolean;
  items: LeadFlowAutomationRecipeResponse[];
}

export function mapAutomationRecipe(
  recipe: LeadFlowAutomationRecipeCatalogItem,
  businessModeKey: string,
): LeadFlowAutomationRecipeResponse {
  return {
    key: recipe.key,
    name: recipe.name,
    description: recipe.description,
    category: recipe.category,
    tier: recipe.tier,
    templateVersion: recipe.templateVersion,
    deprecated: recipe.deprecated,
    trigger: recipe.trigger,
    triggerKind: recipe.triggerKind,
    primaryAction: recipe.primaryAction,
    whenLabel: recipe.whenLabel,
    limitsLabel: recipe.limitsLabel,
    isDeveloperOnly: recipe.isDeveloperOnly,
    requiresApps: [...recipe.requiresApps],
    businessModeKeys:
      recipe.businessModeKeys === 'all' ? 'all' : [...recipe.businessModeKeys],
    compatibleWithBusinessMode: isRecipeCompatible(recipe, businessModeKey),
    unmetDependencies: findUnmetDependencies(recipe.requiredDependencies),
    unavailableActions: unavailableExecutors([recipe.primaryAction]),
    safetyRules: [...recipe.safetyRules],
  };
}
