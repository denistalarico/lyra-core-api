import { Injectable } from '@nestjs/common';
import {
  getRecipeByKey,
  isCustomBusinessMode,
  isRecipeCompatible,
  listRecipes,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';

/**
 * Resolves ready-made automation recipes. Business Mode is owned by LeadFlow
 * Settings — this service never chooses or mutates it, it only reads a key and
 * reports which recipes are compatible with it.
 */
@Injectable()
export class LeadFlowAutomationRecipeService {
  listRecipes(): LeadFlowAutomationRecipeCatalogItem[] {
    return listRecipes();
  }

  getRecipe(recipeKey: string): LeadFlowAutomationRecipeCatalogItem | undefined {
    return getRecipeByKey(recipeKey);
  }

  isCompatible(
    recipe: LeadFlowAutomationRecipeCatalogItem,
    businessModeKey: string,
  ): boolean {
    return isRecipeCompatible(recipe, businessModeKey);
  }

  isCustomBusinessMode(businessModeKey: string): boolean {
    return isCustomBusinessMode(businessModeKey);
  }
}
