import {
  getRecipeByKey,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import {
  LeadFlowAutomationRunStatus,
  LeadFlowAutomationSkipReason,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationEvaluationService } from './leadflow-automation-evaluation.service';

const idleLead = getRecipeByKey(
  'followup_idle_lead',
) as LeadFlowAutomationRecipeCatalogItem;

function buildAutomation(
  overrides: Partial<LeadFlowAutomationEntity> = {},
): LeadFlowAutomationEntity {
  return {
    id: 'automation-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    recipeKey: idleLead.key,
    businessModeKey: 'agency_services',
    templateVersion: 1,
    publishedVersionId: null,
    triggerConfig: { ...idleLead.defaultTriggerConfig },
    conditionConfig: { ...idleLead.defaultConditionConfig },
    actionConfig: { ...idleLead.defaultActionConfig },
    messageConfig: { ...idleLead.defaultMessageConfig },
    crmPolicy: { ...idleLead.defaultCrmPolicy },
    schedulePolicy: { ...idleLead.defaultSchedulePolicy },
    ...overrides,
  } as LeadFlowAutomationEntity;
}

describe('LeadFlowAutomationEvaluationService', () => {
  const service = new LeadFlowAutomationEvaluationService();

  it('acts on a correctly configured automation with default context', () => {
    // The default context models "the trigger just fired" so a dry-run is
    // useful for validating configuration rather than always reporting no.
    const result = service.evaluate(buildAutomation(), idleLead);

    expect(result.wouldAct).toBe(true);
    expect(result.status).toBe(LeadFlowAutomationRunStatus.Succeeded);
    expect(result.skipReason).toBeNull();
    expect(result.plannedActions).toContain('schedule_followup');
  });

  describe('cancellation signals', () => {
    it('cancels when the lead replied', () => {
      const result = service.evaluate(buildAutomation(), idleLead, {
        leadReplied: true,
      });

      expect(result.wouldAct).toBe(false);
      expect(result.status).toBe(LeadFlowAutomationRunStatus.Skipped);
      expect(result.skipReason).toBe(LeadFlowAutomationSkipReason.LeadReplied);
      expect(result.plannedActions).toEqual([]);
    });

    it('cancels when a handoff is in progress', () => {
      const result = service.evaluate(buildAutomation(), idleLead, {
        handoffActive: true,
      });

      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.HandoffInProgress,
      );
    });

    it('cancels outside business hours when the automation requires them', () => {
      const result = service.evaluate(buildAutomation(), idleLead, {
        insideBusinessHours: false,
      });

      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.OutsideBusinessHours,
      );
    });

    it('ignores the business-hours window when the automation opts out', () => {
      const automation = buildAutomation({
        conditionConfig: {
          ...idleLead.defaultConditionConfig,
          businessHoursOnly: false,
        },
      });

      const result = service.evaluate(automation, idleLead, {
        insideBusinessHours: false,
      });

      expect(result.wouldAct).toBe(true);
    });
  });

  describe('rate limits', () => {
    it('stops once the attempt limit is reached', () => {
      const result = service.evaluate(buildAutomation(), idleLead, {
        attemptsSoFar: 3,
      });

      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.AttemptLimitReached,
      );
    });

    it('stops while the cooldown is still active', () => {
      const result = service.evaluate(buildAutomation(), idleLead, {
        hoursSinceLastRun: 1,
      });

      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.CooldownActive,
      );
    });
  });

  describe('qualification', () => {
    it('stops below the configured score', () => {
      const automation = buildAutomation({
        conditionConfig: {
          ...idleLead.defaultConditionConfig,
          minScore: 70,
        },
      });

      const result = service.evaluate(automation, idleLead, { leadScore: 40 });

      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.ScoreBelowThreshold,
      );
    });

    it('defaults the score to the threshold so configuration validates', () => {
      const automation = buildAutomation({
        conditionConfig: {
          ...idleLead.defaultConditionConfig,
          minScore: 70,
        },
      });

      const result = service.evaluate(automation, idleLead);

      expect(result.context.leadScore).toBe(70);
      expect(result.wouldAct).toBe(true);
    });

    it('requires a configured keyword to appear', () => {
      const automation = buildAutomation({
        conditionConfig: {
          ...idleLead.defaultConditionConfig,
          keywords: ['orçamento'],
        },
      });

      expect(service.evaluate(automation, idleLead).skipReason).toBe(
        LeadFlowAutomationSkipReason.ConditionNotMet,
      );
      expect(
        service.evaluate(automation, idleLead, {
          matchedKeywords: ['orçamento'],
        }).wouldAct,
      ).toBe(true);
    });
  });

  describe('data-quality recipes act on absence', () => {
    const automation = buildAutomation({
      conditionConfig: {
        ...idleLead.defaultConditionConfig,
        requiredFields: ['email', 'telefone'],
      },
    });

    it('acts while a required field is still missing', () => {
      const result = service.evaluate(automation, idleLead, {
        presentFields: ['email'],
      });

      expect(result.wouldAct).toBe(true);
      expect(
        result.checks.find((check) => check.key === 'requiredFields')?.detail,
      ).toContain('telefone');
    });

    it('stops once every required field is present', () => {
      const result = service.evaluate(automation, idleLead, {
        presentFields: ['email', 'telefone'],
      });

      expect(result.wouldAct).toBe(false);
      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.ConditionNotMet,
      );
    });
  });

  describe('planned actions', () => {
    it('includes effects derived from the CRM policy', () => {
      const automation = buildAutomation({
        crmPolicy: { addTags: ['quente'], appendNote: true, updateScore: true },
      });

      const result = service.evaluate(automation, idleLead);

      expect(result.plannedActions).toEqual(
        expect.arrayContaining([
          'schedule_followup',
          'add_tag',
          'append_note',
          'update_opportunity_score',
        ]),
      );
    });

    it('does not repeat an action already planned', () => {
      const automation = buildAutomation({
        actionConfig: {
          ...idleLead.defaultActionConfig,
          primaryAction: 'add_tag',
        },
        crmPolicy: { addTags: ['quente'] },
      });

      const result = service.evaluate(automation, idleLead);

      expect(result.plannedActions.filter((a) => a === 'add_tag')).toHaveLength(
        1,
      );
    });
  });

  it('reports the first failing check as the reason', () => {
    // Several conditions fail at once; the operator gets one actionable cause.
    const result = service.evaluate(buildAutomation(), idleLead, {
      leadReplied: true,
      handoffActive: true,
      attemptsSoFar: 99,
    });

    expect(result.skipReason).toBe(LeadFlowAutomationSkipReason.LeadReplied);
    expect(
      result.checks.filter((check) => !check.passed).length,
    ).toBeGreaterThan(1);
  });

  it('refuses to evaluate an automation whose recipe vanished', () => {
    const result = service.evaluate(buildAutomation(), undefined);

    expect(result.wouldAct).toBe(false);
    expect(result.checks[0].key).toBe('recipe');
  });

  it('returns the resolved context so the result is reproducible', () => {
    const result = service.evaluate(buildAutomation(), idleLead, {
      leadScore: 55,
      attemptsSoFar: 1,
    });

    expect(result.context.leadScore).toBe(55);
    expect(result.context.attemptsSoFar).toBe(1);
    expect(result.context.insideBusinessHours).toBe(true);
  });
});
