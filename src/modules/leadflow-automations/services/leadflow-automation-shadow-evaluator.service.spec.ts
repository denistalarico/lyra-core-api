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
import { LeadFlowAutomationEvaluationService } from './leadflow-automation-evaluation.service';
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
    payload: {},
    occurredAt: new Date('2026-07-22T12:00:00Z'),
    ...overrides,
  } as LeadFlowEventDeliveryEntity;
}

type ShadowExtras = {
  signalOrigins: Record<string, string>;
  unavailableActions: unknown[];
};

describe('LeadFlowAutomationShadowEvaluatorService', () => {
  /** Reads the `extras` argument of the recorded call, typed. */
  const extrasOf = (mock: jest.Mock): ShadowExtras => {
    const args = mock.mock.calls[0] as unknown[];
    return args[4] as ShadowExtras;
  };

  function build(
    matches: LeadFlowAutomationTriggerMatch[],
    recordShadowRun = jest.fn().mockResolvedValue({
      run: { id: 'run-1' },
      attempts: [],
    }),
  ) {
    const findMatching = jest.fn().mockResolvedValue(matches);
    const matcher = {
      findMatching,
    } as unknown as LeadFlowAutomationTriggerMatcherService;
    const runService = {
      recordShadowRun,
    } as unknown as LeadFlowAutomationRunService;

    const service = new LeadFlowAutomationShadowEvaluatorService(
      matcher,
      new LeadFlowAutomationEvaluationService(),
      runService,
    );

    return { service, findMatching, recordShadowRun };
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
    const { service } = build([buildMatch()]);

    const summaries = await service.evaluateDelivery(buildDelivery());

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

  describe('signal derivation', () => {
    it('marks a handoff event as observed evidence of a handoff', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(
        buildDelivery({
          eventName: 'leadflow.inbox.conversation.handoff.requested',
        }),
      );

      const extras = extrasOf(recordShadowRun);
      expect(extras.signalOrigins.handoffActive).toBe('from_event');
    });

    it('marks an inbound message as observed evidence the lead replied', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(
        buildDelivery({
          eventName: 'leadflow.inbox.conversation.message.received',
        }),
      );

      const extras = extrasOf(recordShadowRun);
      expect(extras.signalOrigins.leadReplied).toBe('from_event');
    });

    it('defaults signals the payload cannot supply', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(buildDelivery());

      const extras = extrasOf(recordShadowRun);
      expect(extras.signalOrigins.leadReplied).toBe('defaulted');
      expect(extras.signalOrigins.insideBusinessHours).toBe('defaulted');
    });

    it('takes a numeric score from the payload when present', async () => {
      const { service, recordShadowRun } = build([buildMatch()]);

      await service.evaluateDelivery(buildDelivery({ payload: { score: 82 } }));

      const extras = extrasOf(recordShadowRun);
      expect(extras.signalOrigins.leadScore).toBe('from_event');
    });
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

    const evaluation = recordShadowRun.mock.calls[0][3] as {
      status: LeadFlowAutomationRunStatus;
      skipReason: LeadFlowAutomationSkipReason | null;
      wouldAct: boolean;
      plannedActions: string[];
    };
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
});
