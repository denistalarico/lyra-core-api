import {
  isRecipeCompatible,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import { LeadFlowAutomationCategory } from '../enums/leadflow-automation-category.enum';

export interface LeadFlowAutomationRecipeResponse {
  key: string;
  name: string;
  description: string;
  category: LeadFlowAutomationCategory;
  tier: string;
  trigger: string;
  primaryAction: string;
  whenLabel: string;
  limitsLabel: string;
  isDeveloperOnly: boolean;
  requiresApps: string[];
  businessModeKeys: string[] | 'all';
  compatibleWithBusinessMode: boolean;
  safetyRules: string[];
}

export interface LeadFlowAutomationRecipeListResponse {
  businessModeKey: string;
  isCustomBusinessMode: boolean;
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
    trigger: recipe.trigger,
    primaryAction: recipe.primaryAction,
    whenLabel: recipe.whenLabel,
    limitsLabel: recipe.limitsLabel,
    isDeveloperOnly: recipe.isDeveloperOnly,
    requiresApps: [...recipe.requiresApps],
    businessModeKeys:
      recipe.businessModeKeys === 'all'
        ? 'all'
        : [...recipe.businessModeKeys],
    compatibleWithBusinessMode: isRecipeCompatible(recipe, businessModeKey),
    safetyRules: [...recipe.safetyRules],
  };
}
