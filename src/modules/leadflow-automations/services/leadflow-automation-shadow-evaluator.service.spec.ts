import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import {
  getRecipeByKey,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import type { LeadFlowAutomationVersionEntity } from '../entities/leadflow-automation-version.entity';
import {
  LeadFlowAutomationRunMode,
  LeadFlowAutomationRunStatus,
  LeadFlowAutomationSkipReason,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import {
  LEADFLOW_AUTOMATION_CONTEXT_MAX_EVENT_AGE_MS,
  LEADFLOW_AUTOMATION_CONTEXT_SCHEMA_VERSION,
  LeadFlowAutomationContextSignal,
  type LeadFlowAutomationContextSnapshot,
} from '../types/leadflow-automation-context.types';
import { LeadFlowAutomationContextService } from './leadflow-automation-context.service';
import type { LeadFlowAutomationContextLoaderService } from './leadflow-automation-context-loader.service';
import { LeadFlowAutomationEvaluationService } from './leadflow-automation-evaluation.service';
import type { LeadFlowAutomationExecutionService } from './leadflow-automation-execution.service';
import type { LeadFlowAutomationRunService } from './leadflow-automation-run.service';
import { LeadFlowAutomationShadowEvaluatorService } from './leadflow-automation-shadow-evaluator.service';
import type {
  LeadFlowAutomationTriggerMatch,
  LeadFlowAutomationTriggerMatcherService,
} from './leadflow-automation-trigger-matcher.service';

const idleLead = getRecipeByKey(
  'followup_idle_lead',
) as LeadFlowAutomationRecipeCatalogItem;

function buildAutomation(): LeadFlowAutomationEntity {
  return {
    id: 'automation-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    recipeKey: idleLead.key,
    businessModeKey: 'agency_services',
    templateVersion: 1,
    publishedVersionId: '10000000-0000-4000-8000-000000000001',
    status: LeadFlowAutomationStatus.Active,
    triggerConfig: { ...idleLead.defaultTriggerConfig },
    conditionConfig: { ...idleLead.defaultConditionConfig },
    actionConfig: { ...idleLead.defaultActionConfig },
    messageConfig: { ...idleLead.defaultMessageConfig },
    crmPolicy: { ...idleLead.defaultCrmPolicy },
    schedulePolicy: { ...idleLead.defaultSchedulePolicy },
  } as LeadFlowAutomationEntity;
}

function buildMatch(
  overrides: Partial<LeadFlowAutomationEntity> = {},
): LeadFlowAutomationTriggerMatch {
  const source = Object.assign(buildAutomation(), overrides);
  const automation = Object.assign(buildAutomation(), overrides);
  return {
    source,
    automation,
    version: {
      id: '10000000-0000-4000-8000-000000000001',
      automationId: automation.id,
      tenantId: automation.tenantId,
      version: 1,
    } as LeadFlowAutomationVersionEntity,
  };
}

function buildDelivery(
  overrides: Partial<LeadFlowEventDeliveryEntity> = {},
): LeadFlowEventDeliveryEntity {
  return {
    id: 'delivery-1',
    sourceEventId: 'event-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    eventName: 'leadflow.crm.opportunity.created',
    eventVersion: 1,
    aggregateType: 'crm_opportunity',
    aggregateId: '30000000-0000-4000-8000-000000000001',
    payload: {},
    // Recent by default: staleness is a property under test, not a background
    // condition every other assertion has to work around.
    occurredAt: new Date(),
    ...overrides,
  } as LeadFlowEventDeliveryEntity;
}

type RecordedEvaluation = {
  status: LeadFlowAutomationRunStatus;
  skipReason: LeadFlowAutomationSkipReason | null;
  wouldAct: boolean;
  plannedActions: string[];
};

type ShadowExtras = {
  contextSnapshot: LeadFlowAutomationContextSnapshot;
  unavailableActions: unknown[];
};

describe('LeadFlowAutomationShadowEvaluatorService', () => {
  /** Reads the `extras` argument of the recorded call, typed. */
  const extrasOf = (mock: jest.Mock): ShadowExtras => {
    const args = mock.mock.calls[0] as unknown[];
    return args[4] as ShadowExtras;
  };

  /** Reads the `evaluation` argument of the recorded call, typed. */
  const evaluationOf = (mock: jest.Mock): RecordedEvaluation => {
    const args = mock.mock.calls[0] as unknown[];
    return args[3] as RecordedEvaluation;
  };

  const gapFor = (
    snapshot: LeadFlowAutomationContextSnapshot,
    signal: LeadFlowAutomationContextSignal,
  ) => snapshot.gaps.find((record) => record.signal === signal);

  function build(
    matches: LeadFlowAutomationTriggerMatch[],
    recordShadowRun = jest.fn().mockResolvedValue({
      run: { id: 'run-1' },
      attempts: [],
    }),
    execute = jest.fn().mockResolvedValue({
      executed: false,
      reason: 'execution_disabled',
    }),
  ) {
    const findMatching = jest.fn().mockResolvedValue(matches);
    const matcher = {
      findMatching,
    } as unknown as LeadFlowAutomationTriggerMatcherService;
    const runService = {
      recordShadowRun,
    } as unknown as LeadFlowAutomationRunService;
    // Gate closed by default, so these tests observe the shadow behaviour.
    const executionService = {
      execute,
    } as unknown as LeadFlowAutomationExecutionService;

    const service = new LeadFlowAutomationShadowEvaluatorService(
      matcher,
      new LeadFlowAutomationContextService({
        load: jest.fn().mockResolvedValue({
          shared: {},
          perAutomation: new Map(),
          gaps: [],
          cost: { queryCount: 0, durationMs: 0, sources: [] },
        }),
      } as unknown as LeadFlowAutomationContextLoaderService),
      new LeadFlowAutomationEvaluationService(),
      runService,
      executionService,
    );

    return { service, findMatching, recordShadowRun, execute };
  }

  it('records nothing when no automation matches the event', async () => {
    const { service, recordShadowRun } = build([]);

    const summaries = await service.evaluateDelivery(buildDelivery());

    expect(summaries).toEqual([]);
    expect(recordShadowRun).not.toHaveBeenCalled();
  });

  it('records a shadow run for each matching automation', async () => {
    const match = buildMatch();
    const { service, recordShadowRun } = build([match]);

    const summaries = await service.evaluateDelivery(buildDelivery());

    expect(summaries).toHaveLength(1);
    expect(summaries[0].runId).toBe('run-1');
    expect(summaries[0].automationVersionId).toBe(match.version.id);
    expect(recordShadowRun).toHaveBeenCalledTimes(1);
    expect(recordShadowRun).toHaveBeenCalledWith(
      match.automation,
      match.version,
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('reports that no executor could carry the planned action', async () => {
    // The whole point of shadow mode: the decision is real, the effect is not.
    // Uses a configuration that consults no context, so the evaluation reaches
    // action planning and the executor gate is what stops it.
    const { service } = build([
      buildMatch({
        conditionConfig: {},
        actionConfig: { primaryAction: 'schedule_followup' },
        schedulePolicy: {},
      }),
    ]);

    const summaries = await service.evaluateDelivery(buildDelivery());

    expect(summaries[0].wouldAct).toBe(true);
    expect(summaries[0].contextGapCount).toBe(0);
    expect(summaries[0].blockedByExecutor).toBe(true);
  });

  it('scopes the match to the delivery tenant and workspace', async () => {
    // Scope must come from the delivery, never from the payload.
    const { service, findMatching } = build([]);

    await service.evaluateDelivery(
      buildDelivery({
        payload: { tenantId: 'attacker', workspaceId: 'attacker' },
      }),
    );

    expect(findMatching).toHaveBeenCalledWith(
      'tenant-1',
      'workspace-1',
      'leadflow.crm.opportunity.created',
    );
  });

  describe('context resolution', () => {
    it('marks a handoff event as observed evidence of a handoff', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(
        buildDelivery({
          aggregateType: 'inbox_conversation',
          eventName: 'leadflow.inbox.conversation.handoff.requested',
        }),
      );

      const { contextSnapshot } = extrasOf(recordShadowRun);
      expect(
        contextSnapshot.resolved[LeadFlowAutomationContextSignal.HandoffActive],
      ).toEqual({ origin: 'from_event', value: true });
    });

    it('marks an inbound message as observed evidence the lead replied', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(
        buildDelivery({
          aggregateType: 'inbox_conversation',
          eventName: 'leadflow.inbox.conversation.message.received',
        }),
      );

      const { contextSnapshot } = extrasOf(recordShadowRun);
      expect(
        contextSnapshot.resolved[LeadFlowAutomationContextSignal.LeadReplied],
      ).toEqual({ origin: 'from_event', value: true });
    });

    it('records a gap instead of inventing a signal the event cannot supply', async () => {
      // The heart of the change: an unreadable signal stays unresolved. The old
      // behaviour assumed a plausible value and let the verdict look certain.
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(buildDelivery());

      const { contextSnapshot } = extrasOf(recordShadowRun);
      expect(
        contextSnapshot.resolved[
          LeadFlowAutomationContextSignal.InsideBusinessHours
        ],
      ).toBeUndefined();
      expect(
        gapFor(
          contextSnapshot,
          LeadFlowAutomationContextSignal.InsideBusinessHours,
        )?.gap,
      ).toBe('missing_context');
    });

    it('only requires the signals the configuration actually consults', async () => {
      // The idle-lead defaults never mention a score, so nothing should try to
      // establish one.
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(buildDelivery());

      const { contextSnapshot } = extrasOf(recordShadowRun);
      expect(contextSnapshot.required).not.toContain(
        LeadFlowAutomationContextSignal.LeadScore,
      );
    });

    it('reports an unscored opportunity as missing context, never as a lead that failed', async () => {
      // The loader answered nothing for this opportunity: the verdict must say
      // "could not check", not "the score was too low".
      const { service, recordShadowRun } = build([
        buildMatch({
          conditionConfig: { ...idleLead.defaultConditionConfig, minScore: 70 },
        }),
      ]);

      await service.evaluateDelivery(buildDelivery());

      const { contextSnapshot } = extrasOf(recordShadowRun);
      const gap = gapFor(
        contextSnapshot,
        LeadFlowAutomationContextSignal.LeadScore,
      );
      expect(gap?.gap).toBe('missing_context');
    });

    it('refuses to choose between disagreeing subject references', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(
        buildDelivery({
          aggregateType: 'inbox_conversation',
          aggregateId: '20000000-0000-4000-8000-000000000001',
          payload: { conversationId: '20000000-0000-4000-8000-000000000002' },
        }),
      );

      const { contextSnapshot } = extrasOf(recordShadowRun);
      expect(
        gapFor(contextSnapshot, LeadFlowAutomationContextSignal.LeadReplied)
          ?.gap,
      ).toBe('ambiguous_context');
    });

    it('flags state reads as stale when the event waited too long', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(
        buildDelivery({
          occurredAt: new Date(
            Date.now() - LEADFLOW_AUTOMATION_CONTEXT_MAX_EVENT_AGE_MS - 1000,
          ),
        }),
      );

      const { contextSnapshot } = extrasOf(recordShadowRun);
      expect(
        gapFor(
          contextSnapshot,
          LeadFlowAutomationContextSignal.InsideBusinessHours,
        )?.gap,
      ).toBe('stale_context');
    });

    it('costs no queries while resolution is envelope-only', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(buildDelivery());

      expect(extrasOf(recordShadowRun).contextSnapshot.cost.queryCount).toBe(0);
    });

    it('persists a versioned snapshot so the verdict stays re-readable', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(buildDelivery());

      const { contextSnapshot } = extrasOf(recordShadowRun);
      expect(contextSnapshot.schemaVersion).toBe(
        LEADFLOW_AUTOMATION_CONTEXT_SCHEMA_VERSION,
      );
      expect(contextSnapshot.capturedAt).toEqual(expect.any(String));
    });
  });

  it('does not act when a required signal could not be established', async () => {
    const { service, recordShadowRun } = build([buildMatch()]);

    const summaries = await service.evaluateDelivery(buildDelivery());

    expect(summaries[0].wouldAct).toBe(false);
    expect(summaries[0].contextGapCount).toBeGreaterThan(0);
    const evaluation = evaluationOf(recordShadowRun);
    expect(evaluation.skipReason).toBe(
      LeadFlowAutomationSkipReason.MissingContext,
    );
  });

  it('propagates persistence failure so ingress can retry the delivery', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = build([buildMatch()], failing);

    await expect(service.evaluateDelivery(buildDelivery())).rejects.toThrow(
      'db down',
    );
  });

  it('records a paused published automation as not active', async () => {
    const { service, recordShadowRun } = build([
      buildMatch({ status: LeadFlowAutomationStatus.Paused }),
    ]);

    await service.evaluateDelivery(buildDelivery());

    const evaluation = evaluationOf(recordShadowRun);
    expect(evaluation).toMatchObject({
      status: LeadFlowAutomationRunStatus.Skipped,
      skipReason: LeadFlowAutomationSkipReason.NotActive,
      wouldAct: false,
      plannedActions: [],
    });
  });

  it('uses the shadow mode, never live', () => {
    // Guards the honesty invariant at the type level.
    expect(LeadFlowAutomationRunMode.Shadow).toBe('shadow');
    expect(LeadFlowAutomationRunMode.Live).toBe('live');
  });

  describe('gated execution', () => {
    /** A match whose only planned action is the available stage transition. */
    const executable = () =>
      buildMatch({
        conditionConfig: {},
        actionConfig: { primaryAction: 'move_opportunity_stage' },
        schedulePolicy: {},
      });

    it('offers an eligible verdict to execution', async () => {
      const { service, execute } = build([executable()]);

      await service.evaluateDelivery(buildDelivery());

      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('records a live run and no shadow run when the gate executes', async () => {
      const execute = jest
        .fn()
        .mockResolvedValue({ executed: true, runId: 'live-run-9' });
      const { service, recordShadowRun } = build(
        [executable()],
        undefined,
        execute,
      );

      const summaries = await service.evaluateDelivery(buildDelivery());

      expect(summaries[0]).toMatchObject({
        runId: 'live-run-9',
        executed: true,
        blockedByExecutor: false,
      });
      // The whole point: a real effect does not also leave a shadow record.
      expect(recordShadowRun).not.toHaveBeenCalled();
    });

    it('falls back to a shadow run when the gate refuses', async () => {
      // Default build: execute returns { executed: false }.
      const { service, recordShadowRun } = build([executable()]);

      const summaries = await service.evaluateDelivery(buildDelivery());

      expect(summaries[0].executed).toBe(false);
      expect(recordShadowRun).toHaveBeenCalledTimes(1);
    });

    it('never offers an ineligible verdict to execution', async () => {
      // The idle-lead recipe's primary action is unavailable, so nothing is
      // eligible and execution is never consulted.
      const { service, execute } = build([buildMatch()]);

      await service.evaluateDelivery(buildDelivery());

      expect(execute).not.toHaveBeenCalled();
    });
  });
});
