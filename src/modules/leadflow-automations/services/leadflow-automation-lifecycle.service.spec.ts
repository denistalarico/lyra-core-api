import {
  getRecipeByKey,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import { LeadFlowAutomationLifecycleState } from '../enums/leadflow-automation-lifecycle-state.enum';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationLifecycleService } from './leadflow-automation-lifecycle.service';

const idleLead = getRecipeByKey(
  'followup_idle_lead',
) as LeadFlowAutomationRecipeCatalogItem;

/** A hypothetical recipe whose dependencies are all satisfied. */
const unblocked: LeadFlowAutomationRecipeCatalogItem = {
  ...idleLead,
  requiredDependencies: [],
};

describe('LeadFlowAutomationLifecycleService', () => {
  const service = new LeadFlowAutomationLifecycleService();

  const evaluate = (
    overrides: Partial<Parameters<typeof service.evaluate>[0]> = {},
  ) =>
    service.evaluate({
      status: LeadFlowAutomationStatus.Draft,
      recipe: unblocked,
      compatibleWithBusinessMode: true,
      missingConfiguration: [],
      ...overrides,
    });

  it('reports no runtime available on the current platform', () => {
    // The whole point of Phase 1: nothing can execute yet, and the API says so.
    expect(evaluate().runtimeAvailable).toBe(false);
  });

  describe('dependency gating', () => {
    it('blocks a recipe whose dependencies are unmet', () => {
      const result = evaluate({ recipe: idleLead });

      expect(result.state).toBe(
        LeadFlowAutomationLifecycleState.BlockedByDependency,
      );
      expect(result.canActivate).toBe(false);
      expect(result.unmetDependencies.length).toBeGreaterThan(0);
      expect(result.blockedReason).toBeTruthy();
    });

    it('reports a persisted `active` row as blocked, not active', () => {
      // Rows switched on before gating existed must not keep claiming to run.
      const result = evaluate({
        recipe: idleLead,
        status: LeadFlowAutomationStatus.Active,
      });

      expect(result.state).toBe(
        LeadFlowAutomationLifecycleState.BlockedByDependency,
      );
      expect(result.status).toBe(LeadFlowAutomationStatus.Active);
      expect(result.canActivate).toBe(false);
    });

    it('outranks a configuration problem, because config cannot fix it', () => {
      const result = evaluate({
        recipe: idleLead,
        missingConfiguration: ['trigger.delayHours'],
      });

      expect(result.state).toBe(
        LeadFlowAutomationLifecycleState.BlockedByDependency,
      );
    });

    it('every catalogued recipe is blocked today', () => {
      for (const recipe of [idleLead]) {
        expect(evaluate({ recipe }).canActivate).toBe(false);
      }
    });
  });

  describe('states once dependencies are satisfied', () => {
    it('is ready when fully configured', () => {
      const result = evaluate();

      expect(result.state).toBe(LeadFlowAutomationLifecycleState.Ready);
      expect(result.canActivate).toBe(true);
      expect(result.blockedReason).toBeNull();
    });

    it('requires configuration when a required field is empty', () => {
      const result = evaluate({
        missingConfiguration: ['conditions.requiredFields'],
      });

      expect(result.state).toBe(
        LeadFlowAutomationLifecycleState.RequiresConfiguration,
      );
      expect(result.canActivate).toBe(false);
      expect(result.missingConfiguration).toContain(
        'conditions.requiredFields',
      );
    });

    it('requires configuration when the business mode does not match', () => {
      const result = evaluate({ compatibleWithBusinessMode: false });

      expect(result.state).toBe(
        LeadFlowAutomationLifecycleState.RequiresConfiguration,
      );
      expect(result.canActivate).toBe(false);
    });

    it('reports paused and allows switching back on', () => {
      const result = evaluate({ status: LeadFlowAutomationStatus.Paused });

      expect(result.state).toBe(LeadFlowAutomationLifecycleState.Paused);
      expect(result.canActivate).toBe(true);
    });

    it('reports active without offering to activate again', () => {
      const result = evaluate({ status: LeadFlowAutomationStatus.Active });

      expect(result.state).toBe(LeadFlowAutomationLifecycleState.Active);
      expect(result.canActivate).toBe(false);
    });

    it('surfaces the error state and refuses reactivation', () => {
      const result = evaluate({ status: LeadFlowAutomationStatus.Error });

      expect(result.state).toBe(LeadFlowAutomationLifecycleState.Error);
      expect(result.canActivate).toBe(false);
    });

    it('treats an archived instance as deprecated', () => {
      const result = evaluate({ status: LeadFlowAutomationStatus.Archived });

      expect(result.state).toBe(LeadFlowAutomationLifecycleState.Deprecated);
      expect(result.canActivate).toBe(false);
    });
  });

  describe('catalog drift', () => {
    it('marks an instance whose recipe vanished as deprecated', () => {
      const result = evaluate({ recipe: undefined });

      expect(result.state).toBe(LeadFlowAutomationLifecycleState.Deprecated);
      expect(result.canActivate).toBe(false);
    });

    it('refuses a deprecated recipe even when fully configured', () => {
      const result = evaluate({
        recipe: { ...unblocked, deprecated: true },
      });

      expect(result.state).toBe(LeadFlowAutomationLifecycleState.Deprecated);
      expect(result.canActivate).toBe(false);
    });
  });
});
