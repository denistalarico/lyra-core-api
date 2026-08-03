import type { LeadFlowAutomationRecipeCatalogItem } from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationSummaryResponse } from './leadflow-automation-response.dto';
import {
  mapAutomationRecipe,
  type LeadFlowAutomationRecipeResponse,
} from './leadflow-automation-recipe-response.dto';

/**
 * One available recipe plus every provisioned instance in the active context.
 *
 * Recipes remain catalog contracts, while instances remain persisted operator
 * configurations. Keeping both shapes in this view model prevents the UI from
 * calling a recipe active merely because an instance happens to exist.
 */
export interface LeadFlowAutomationCatalogItemResponse {
  recipe: LeadFlowAutomationRecipeResponse;
  instances: LeadFlowAutomationSummaryResponse[];
}

export interface LeadFlowAutomationCatalogResponse {
  businessModeKey: string;
  isCustomBusinessMode: boolean;
  runtimeAvailable: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: LeadFlowAutomationCatalogItemResponse[];
}

export function paginateAutomationCatalog<T>(
  items: T[],
  pagination: { page?: number; pageSize?: number } = {},
): { page: number; pageSize: number; total: number; items: T[] } {
  const pageSize = Math.min(Math.max(pagination.pageSize ?? 50, 1), 100);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(pagination.page ?? 1, 1), pageCount);

  return {
    page,
    pageSize,
    total,
    items: items.slice((page - 1) * pageSize, page * pageSize),
  };
}

export function buildAutomationCatalogItems(
  recipes: LeadFlowAutomationRecipeCatalogItem[],
  instances: LeadFlowAutomationSummaryResponse[],
  businessModeKey: string,
): LeadFlowAutomationCatalogItemResponse[] {
  const instancesByRecipe = new Map<
    string,
    LeadFlowAutomationSummaryResponse[]
  >();

  for (const instance of instances) {
    const current = instancesByRecipe.get(instance.recipeKey) ?? [];
    current.push(instance);
    instancesByRecipe.set(instance.recipeKey, current);
  }

  return recipes.map((recipe) => ({
    recipe: mapAutomationRecipe(recipe, businessModeKey),
    // Preserve each instance (including its id, publication and readiness)
    // instead of collapsing a recipe to a provisioned boolean.
    instances: instancesByRecipe.get(recipe.key) ?? [],
  }));
}
