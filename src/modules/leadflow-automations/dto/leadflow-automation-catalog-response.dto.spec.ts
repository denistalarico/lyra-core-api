import { listRecipes } from '../catalog/automation-recipes.catalog';
import { LeadFlowAutomationCategory } from '../enums/leadflow-automation-category.enum';
import { LeadFlowAutomationLifecycleState } from '../enums/leadflow-automation-lifecycle-state.enum';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import {
  buildAutomationCatalogItems,
  paginateAutomationCatalog,
} from './leadflow-automation-catalog-response.dto';
import type { LeadFlowAutomationSummaryResponse } from './leadflow-automation-response.dto';

function instance(
  id: string,
  recipeKey: string,
  publishedVersionId: string | null,
): LeadFlowAutomationSummaryResponse {
  return {
    id,
    recipeKey,
    name: `Instância ${id}`,
    description: null,
    category: LeadFlowAutomationCategory.Followup,
    tier: 'essential',
    status: LeadFlowAutomationStatus.Draft,
    businessModeKey: 'agency_services',
    triggerType: 'conversation.created',
    triggerKind: 'event',
    primaryAction: 'send_message',
    isDeveloperRecipe: false,
    compatibleWithBusinessMode: true,
    templateVersion: 1,
    templateOutdated: false,
    readiness: { level: 'ready' },
    publishedVersionId,
    updatedAt: '2026-08-03T12:00:00.000Z',
    lifecycle: {
      state: LeadFlowAutomationLifecycleState.Ready,
      status: LeadFlowAutomationStatus.Draft,
      canActivate: true,
      blockedReason: null,
      unmetDependencies: [],
      unavailableActions: [],
      missingConfiguration: [],
      runtimeAvailable: true,
    },
  };
}

describe('automation catalog response', () => {
  const recipes = listRecipes().slice(0, 2);

  it('keeps an available recipe when it has no provisioned instance', () => {
    const items = buildAutomationCatalogItems(recipes, [], 'agency_services');

    expect(items).toHaveLength(2);
    expect(items[0].recipe.key).toBe(recipes[0].key);
    expect(items[0].instances).toEqual([]);
  });

  it('preserves multiple instances and their publication identity', () => {
    const items = buildAutomationCatalogItems(
      recipes,
      [
        instance('first', recipes[0].key, 'published-first'),
        instance('second', recipes[0].key, null),
      ],
      'agency_services',
    );

    expect(items[0].instances.map((item) => item.id)).toEqual([
      'first',
      'second',
    ]);
    expect(items[0].instances[0].publishedVersionId).toBe('published-first');
    expect(items[1].instances).toEqual([]);
  });

  it('keeps recipe compatibility separate from persisted instance readiness', () => {
    const [agendaRecipe] = listRecipes().filter(
      (recipe) => recipe.key === 'appointment_reminder',
    );
    const [item] = buildAutomationCatalogItems(
      [agendaRecipe],
      [instance('legacy', agendaRecipe.key, 'published-legacy')],
      'ecommerce_light',
    );

    expect(item.recipe.compatibleWithBusinessMode).toBe(false);
    expect(item.instances[0].lifecycle?.state).toBe('ready');
  });

  it('paginates recipes without changing their total or accepting unsafe sizes', () => {
    const page = paginateAutomationCatalog(['one', 'two', 'three'], {
      page: 2,
      pageSize: 2,
    });
    const bounded = paginateAutomationCatalog(['one'], {
      page: 99,
      pageSize: 999,
    });

    expect(page).toEqual({ page: 2, pageSize: 2, total: 3, items: ['three'] });
    expect(bounded).toEqual({ page: 1, pageSize: 100, total: 1, items: ['one'] });
  });
});
