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

  it('reports an execution runtime now that a productive executor exists', () => {
    // The governed stage-transition executor is real and its dependency is
    // satisfied, so the platform genuinely can carry out an effect. The canary
    // gate — a separate concern — is what limits which tenants may.
    expect(evaluate().runtimeAvailable).toBe(true);
  });

  describe('dependency gating', () => {
    it('reports the follow-up recipe dependencies as satisfied after Fase 6', () => {
      const result = evaluate({ recipe: idleLead });

      expect(result.state).toBe(LeadFlowAutomationLifecycleState.Ready);
      expect(result.canActivate).toBe(true);
      expect(result.unmetDependencies).toEqual([]);
    });

    it('reports a persisted active follow-up row as active', () => {
      const result = evaluate({
        recipe: idleLead,
        status: LeadFlowAutomationStatus.Active,
      });

      expect(result.state).toBe(LeadFlowAutomationLifecycleState.Active);
      expect(result.status).toBe(LeadFlowAutomationStatus.Active);
      expect(result.canActivate).toBe(false);
    });

    it('surfaces configuration now that dependencies are available', () => {
      const result = evaluate({
        recipe: idleLead,
        missingConfiguration: ['trigger.delayHours'],
      });

      expect(result.state).toBe(
        LeadFlowAutomationLifecycleState.RequiresConfiguration,
      );
    });

    it('the follow-up recipe can activate when configured', () => {
      for (const recipe of [idleLead]) {
        expect(evaluate({ recipe }).canActivate).toBe(true);
      }
    });
  });

  describe('executor gating', () => {
    it('blocks activation when ingress exists but the action adapter does not', () => {
      const unavailableAction = {
        actionKey: 'notify_user',
        available: false,
        reason: 'not_implemented' as const,
        dependency: null,
        owningDomain: 'platform.notifications',
        description: 'Adapter ainda não implementado.',
      };

      const result = evaluate({ unavailableActions: [unavailableAction] });

      expect(result.state).toBe(
        LeadFlowAutomationLifecycleState.BlockedByDependency,
      );
      expect(result.canActivate).toBe(false);
      expect(result.unmetDependencies).toEqual([]);
      expect(result.unavailableActions).toEqual([unavailableAction]);
      expect(result.blockedReason).toBe(unavailableAction.description);
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
