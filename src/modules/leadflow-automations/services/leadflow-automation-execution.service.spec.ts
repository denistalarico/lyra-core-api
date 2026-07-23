import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import type { LeadFlowAutomationVersionEntity } from '../entities/leadflow-automation-version.entity';
import type { AutomationEffectResult } from '../executors';
import type { MoveOpportunityStageExecutor } from '../executors/move-opportunity-stage.executor';
import type { LeadFlowAutomationContextSnapshot } from '../types/leadflow-automation-context.types';
import type { LeadFlowAutomationEvaluation } from './leadflow-automation-evaluation.service';
import { LeadFlowAutomationExecutionService } from './leadflow-automation-execution.service';
import type { LeadFlowAutomationExecutionGate } from './leadflow-automation-execution-gate.service';
import type { LeadFlowAutomationRunService } from './leadflow-automation-run.service';

const OPPORTUNITY = '30000000-0000-4000-8000-000000000001';

function automation(): LeadFlowAutomationEntity {
  return {
    id: 'automation-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    recipeKey: 'governed_stage_advance',
    crmPolicy: {
      moveStageOnComplete: 'stage-2',
      moveStageReasonCode: 'qualified',
    },
  } as LeadFlowAutomationEntity;
}

function evaluation(): LeadFlowAutomationEvaluation {
  return {
    wouldAct: true,
    plannedActions: ['move_opportunity_stage'],
  } as LeadFlowAutomationEvaluation;
}

function delivery(
  overrides: Partial<LeadFlowEventDeliveryEntity> = {},
): LeadFlowEventDeliveryEntity {
  return {
    id: 'delivery-1',
    sourceEventId: 'event-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    eventName: 'leadflow.crm.opportunity.updated',
    aggregateType: 'crm_opportunity',
    aggregateId: OPPORTUNITY,
    payload: { rowVersion: 4 },
    occurredAt: new Date(),
    ...overrides,
  } as LeadFlowEventDeliveryEntity;
}

const snapshot = {
  schemaVersion: 1,
  capturedAt: '2026-07-23T12:00:00Z',
  subjects: { crm_opportunity: OPPORTUNITY },
  cost: { queryCount: 1, durationMs: 2, sources: [] },
  gaps: [],
} as unknown as LeadFlowAutomationContextSnapshot;

function build(options: {
  gate: { allowed: boolean; reason?: string };
  result?: AutomationEffectResult;
}) {
  const execute = jest.fn().mockResolvedValue(
    options.result ?? {
      status: 'confirmed',
      effectConfirmed: true,
      reference: OPPORTUNITY,
    },
  );
  const moveStageExecutor = {
    actionKey: 'move_opportunity_stage',
    execute,
  } as unknown as MoveOpportunityStageExecutor;

  const gate = {
    evaluate: jest.fn().mockResolvedValue(
      options.gate.allowed
        ? { allowed: true }
        : {
            allowed: false,
            reason: options.gate.reason ?? 'execution_disabled',
          },
    ),
  } as unknown as LeadFlowAutomationExecutionGate;

  const recordLiveRun = jest
    .fn()
    .mockResolvedValue({ run: { id: 'live-run-1' }, attempts: [] });
  const runService = {
    recordLiveRun,
  } as unknown as LeadFlowAutomationRunService;

  const service = new LeadFlowAutomationExecutionService(
    gate,
    runService,
    moveStageExecutor,
  );
  return { service, execute, recordLiveRun };
}

const input = () => ({
  automation: automation(),
  version: { id: 'version-1', version: 1 } as LeadFlowAutomationVersionEntity,
  recipe: {
    trigger: 'opportunity.updated' as const,
    triggerKind: 'event' as const,
  },
  evaluation: evaluation(),
  delivery: delivery(),
  contextSnapshot: snapshot,
});

describe('LeadFlowAutomationExecutionService', () => {
  it('does not execute when the gate is closed', async () => {
    const { service, execute, recordLiveRun } = build({
      gate: { allowed: false, reason: 'execution_disabled' },
    });

    const outcome = await service.execute(input());

    expect(outcome).toEqual({ executed: false, reason: 'execution_disabled' });
    expect(execute).not.toHaveBeenCalled();
    expect(recordLiveRun).not.toHaveBeenCalled();
  });

  it('executes and records a live run when the gate is open', async () => {
    const { service, execute, recordLiveRun } = build({
      gate: { allowed: true },
    });

    const outcome = await service.execute(input());

    expect(outcome).toEqual({ executed: true, runId: 'live-run-1' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recordLiveRun).toHaveBeenCalledTimes(1);

    const effects = (recordLiveRun.mock.calls[0] as unknown[])[4] as {
      effects: Array<{ result: AutomationEffectResult }>;
    };
    expect(effects.effects[0].result.effectConfirmed).toBe(true);
  });

  it('builds the effect request from config, envelope and revalidation', async () => {
    const { service, execute } = build({ gate: { allowed: true } });

    await service.execute(input());

    const request = (execute.mock.calls[0] as unknown[])[0] as {
      payload: Record<string, unknown>;
      revalidation: { expectedVersion: number | null };
      actorRef: string;
    };
    expect(request.payload).toMatchObject({
      opportunityId: OPPORTUNITY,
      toStageId: 'stage-2',
      reasonCode: 'qualified',
    });
    // Expected version comes from the event payload, closing the decision→act gap.
    expect(request.revalidation.expectedVersion).toBe(4);
    expect(request.actorRef).toBe('automation:automation-1');
  });

  it('still records a live run when the effect was governed-refused', async () => {
    // A refusal is a real outcome of a live attempt, not a shadow verdict.
    const { service, recordLiveRun } = build({
      gate: { allowed: true },
      result: {
        status: 'refused',
        effectConfirmed: false,
        errorCode: 'automatic_terminal_transition',
      },
    });

    const outcome = await service.execute(input());

    expect(outcome).toMatchObject({ executed: true });
    expect(recordLiveRun).toHaveBeenCalledTimes(1);
  });

  it('refuses when the event names no opportunity', async () => {
    const { service, execute } = build({ gate: { allowed: true } });

    const outcome = await service.execute({
      ...input(),
      delivery: delivery({
        aggregateType: 'inbox_conversation',
        aggregateId: 'conversation-1',
      }),
    });

    expect(outcome).toEqual({
      executed: false,
      reason: 'no_opportunity_in_envelope',
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
