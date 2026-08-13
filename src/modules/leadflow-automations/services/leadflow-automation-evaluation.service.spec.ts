import {
  getRecipeByKey,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import {
  LeadFlowAutomationRunStatus,
  LeadFlowAutomationSkipReason,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationContextSignal } from '../types/leadflow-automation-context.types';
import { LeadFlowAutomationContextService } from './leadflow-automation-context.service';
import type { LeadFlowAutomationContextLoaderService } from './leadflow-automation-context-loader.service';
import {
  LeadFlowAutomationEvaluationService,
  type LeadFlowAutomationEvaluationContext,
} from './leadflow-automation-evaluation.service';

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
  const contextService = new LeadFlowAutomationContextService({
    load: jest.fn().mockResolvedValue({
      shared: {},
      perAutomation: new Map(),
      gaps: [],
      cost: { queryCount: 0, durationMs: 0, sources: [] },
    }),
  } as unknown as LeadFlowAutomationContextLoaderService);

  /**
   * Evaluates the way the dry-run endpoint does: context is resolved first, so
   * a signal the operator did not assert is either a declared simulator
   * assumption or an explicit gap — never an invented value.
   */
  function simulate(
    automation: LeadFlowAutomationEntity,
    input: LeadFlowAutomationEvaluationContext = {},
    recipe: LeadFlowAutomationRecipeCatalogItem | undefined = idleLead,
  ) {
    const resolution = contextService.resolveForSimulation(automation, input);
    return service.evaluate(
      automation,
      recipe,
      resolution.context,
      resolution.gaps,
    );
  }

  it('acts on a correctly configured automation with the simulator defaults', () => {
    // The simulator's stand-ins model "the trigger just fired", so a dry-run is
    // useful for validating configuration rather than always reporting no.
    const result = simulate(buildAutomation());

    expect(result.wouldAct).toBe(true);
    expect(result.status).toBe(LeadFlowAutomationRunStatus.Succeeded);
    expect(result.skipReason).toBeNull();
    expect(result.plannedActions).toContain('schedule_followup');
  });

  describe('cancellation signals', () => {
    it('cancels when the lead replied', () => {
      const result = simulate(buildAutomation(), { leadReplied: true });

      expect(result.wouldAct).toBe(false);
      expect(result.status).toBe(LeadFlowAutomationRunStatus.Skipped);
      expect(result.skipReason).toBe(LeadFlowAutomationSkipReason.LeadReplied);
      expect(result.plannedActions).toEqual([]);
    });

    it('cancels when a handoff is in progress', () => {
      const result = simulate(buildAutomation(), { handoffActive: true });

      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.HandoffInProgress,
      );
    });

    it('cancels outside business hours when the automation requires them', () => {
      const result = simulate(buildAutomation(), {
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

      const result = simulate(automation, { insideBusinessHours: false });

      expect(result.wouldAct).toBe(true);
    });
  });

  describe('rate limits', () => {
    it('stops once the attempt limit is reached', () => {
      // Four attempts now: the cadence is d0, d1, d3 and d7.
      const result = simulate(buildAutomation(), { attemptsSoFar: 4 });

      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.AttemptLimitReached,
      );
    });

    it('stops while the cooldown is still active', () => {
      const result = simulate(buildAutomation(), { hoursSinceLastRun: 1 });

      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.CooldownActive,
      );
    });
  });

  describe('qualification', () => {
    const scored = () =>
      buildAutomation({
        conditionConfig: { ...idleLead.defaultConditionConfig, minScore: 70 },
      });

    it('stops below the threshold once a score can actually be established', () => {
      // Evaluated directly with a resolved score: this is the comparison the
      // CRM's Lead Score V1 will feed. Until then the dependency gate below
      // prevents it from ever running.
      const result = service.evaluate(
        scored(),
        idleLead,
        {
          leadScore: 40,
          insideBusinessHours: true,
          leadReplied: false,
          handoffActive: false,
          attemptsSoFar: 0,
          hoursSinceLastRun: 999,
        },
        {},
      );

      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.ScoreBelowThreshold,
      );
    });

    it('never lets an absent score satisfy the threshold it is compared against', () => {
      // The defect this replaces: the score defaulted to the configured minimum,
      // so `minScore` always passed and the automation reported it would act on
      // a lead nobody had measured. With the Score Engine live the simulator
      // still refuses to invent one — the operator must state it.
      const result = simulate(scored());

      expect(result.wouldAct).toBe(false);
      expect(result.context.leadScore).toBeUndefined();
      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.MissingContext,
      );
    });

    it('asks the operator for a value instead of blaming the lead', () => {
      const result = simulate(scored());

      const gap = result.gaps.find(
        (item) => item.signal === LeadFlowAutomationContextSignal.LeadScore,
      );
      expect(gap?.gap).toBe('missing_context');
      expect(gap?.detail).toContain('informe um valor');
    });

    it('evaluates an asserted score now that the Score Engine is canonical', () => {
      // The capability exists, so exploring a hypothetical score is a valid
      // simulation rather than a promise the platform cannot keep.
      expect(simulate(scored(), { leadScore: 90 }).wouldAct).toBe(true);
      expect(simulate(scored(), { leadScore: 40 }).skipReason).toBe(
        LeadFlowAutomationSkipReason.ScoreBelowThreshold,
      );
    });

    it('requires a configured keyword to appear', () => {
      const automation = buildAutomation({
        conditionConfig: {
          ...idleLead.defaultConditionConfig,
          keywords: ['orçamento'],
        },
      });

      // Nothing observed the message, so the answer is "unknown", not "no".
      expect(simulate(automation).skipReason).toBe(
        LeadFlowAutomationSkipReason.MissingContext,
      );
      expect(
        simulate(automation, { matchedKeywords: ['orçamento'] }).wouldAct,
      ).toBe(true);
      expect(
        simulate(automation, { matchedKeywords: ['outra'] }).skipReason,
      ).toBe(LeadFlowAutomationSkipReason.ConditionNotMet);
    });
  });

  describe('data-quality recipes act on absence', () => {
    const automation = () =>
      buildAutomation({
        conditionConfig: {
          ...idleLead.defaultConditionConfig,
          requiredFields: ['email', 'telefone'],
        },
      });

    it('acts while a required field is still missing', () => {
      const result = simulate(automation(), { presentFields: ['email'] });

      expect(result.wouldAct).toBe(true);
      expect(
        result.checks.find((check) => check.key === 'requiredFields')?.detail,
      ).toContain('telefone');
    });

    it('stops once every required field is present', () => {
      const result = simulate(automation(), {
        presentFields: ['email', 'telefone'],
      });

      expect(result.wouldAct).toBe(false);
      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.ConditionNotMet,
      );
    });

    it('does not treat an unreadable record as an empty one', () => {
      // Otherwise the automation would chase a lead for data already provided.
      const result = simulate(automation());

      expect(result.wouldAct).toBe(false);
      expect(result.skipReason).toBe(
        LeadFlowAutomationSkipReason.MissingContext,
      );
    });
  });

  describe('planned actions', () => {
    it('includes effects derived from the CRM policy', () => {
      const automation = buildAutomation({
        crmPolicy: { addTags: ['quente'], appendNote: true, updateScore: true },
      });

      const result = simulate(automation);

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

      const result = simulate(automation);

      expect(result.plannedActions.filter((a) => a === 'add_tag')).toHaveLength(
        1,
      );
    });

    it('plans only fully configured governed CRM actions', () => {
      const automation = buildAutomation({
        crmPolicy: {
          moveStageOnComplete: 'stage-2',
          moveStageReasonCode: 'qualified',
          transferToPipelineRef: 'pipeline-2',
          transferToStageRef: 'stage-3',
          transferReasonCode: 'specialist_route',
          copyToPipelineRef: 'pipeline-3',
          copyToStageRef: 'stage-4',
          copyReasonCode: 'parallel_process',
        },
      });

      expect(simulate(automation).plannedActions).toEqual(
        expect.arrayContaining([
          'move_opportunity_stage',
          'transfer_opportunity_pipeline',
          'copy_opportunity',
        ]),
      );

      automation.crmPolicy.copyReasonCode = null;
      expect(simulate(automation).plannedActions).not.toContain(
        'copy_opportunity',
      );
    });
  });

  it('reports the first failing check as the reason', () => {
    // Several conditions fail at once; the operator gets one actionable cause.
    const result = simulate(buildAutomation(), {
      leadReplied: true,
      handoffActive: true,
      attemptsSoFar: 99,
    });

    expect(result.skipReason).toBe(LeadFlowAutomationSkipReason.LeadReplied);
    expect(
      result.checks.filter((check) => !check.passed).length,
    ).toBeGreaterThan(1);
  });

  it('prefers an observed refusal over an unresolved signal', () => {
    // The lead replying is a certain no; a gap only becomes the headline when
    // resolving it might have let the automation act.
    const automation = buildAutomation({
      conditionConfig: {
        ...idleLead.defaultConditionConfig,
        keywords: ['orçamento'],
      },
    });

    const result = simulate(automation, { leadReplied: true });

    expect(result.skipReason).toBe(LeadFlowAutomationSkipReason.LeadReplied);
  });

  it('refuses to evaluate an automation whose recipe vanished', () => {
    const automation = buildAutomation();
    const resolution = contextService.resolveForSimulation(automation);

    const result = service.evaluate(
      automation,
      undefined,
      resolution.context,
      resolution.gaps,
    );

    expect(result.wouldAct).toBe(false);
    expect(result.checks[0].key).toBe('recipe');
  });

  it('returns only the signals that were established', () => {
    const result = simulate(buildAutomation(), { attemptsSoFar: 1 });

    expect(result.context.attemptsSoFar).toBe(1);
    expect(result.context.insideBusinessHours).toBe(true);
    // Never consulted by this configuration, so never resolved.
    expect(result.context.leadScore).toBeUndefined();
  });
});
