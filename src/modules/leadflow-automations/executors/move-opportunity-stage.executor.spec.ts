import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import type { CrmStageTransitionPolicyService } from '../../crm/services/crm-stage-transition-policy.service';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import type { AutomationEffectRequest } from './automation-executor.types';
import { MoveOpportunityStageExecutor } from './move-opportunity-stage.executor';

function request(
  overrides: Partial<AutomationEffectRequest> = {},
): AutomationEffectRequest {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    runId: 'event-1',
    attemptNumber: 1,
    actionKey: 'move_opportunity_stage',
    correlationId: 'event-1',
    idempotencyKey: 'effect:abc',
    actorRef: 'automation:automation-1',
    policyRef: 'stage_transition:version-1',
    payload: {
      opportunityId: 'opportunity-1',
      toStageId: 'stage-2',
      reasonCode: 'qualified',
    },
    revalidation: {
      contextSchemaVersion: 1,
      capturedAt: '2026-07-23T12:00:00Z',
      subjects: { crm_opportunity: 'opportunity-1' },
      expectedVersion: 4,
    },
    ...overrides,
  };
}

function build(
  moveStage: jest.Mock,
  resolveEligibleAutomationDestination: jest.Mock = jest
    .fn()
    .mockResolvedValue(null),
) {
  const crmCommand = { moveStage } as unknown as CrmOpportunityCommandService;
  const transitionPolicies = {
    resolveEligibleAutomationDestination,
  } as unknown as CrmStageTransitionPolicyService;
  return new MoveOpportunityStageExecutor(crmCommand, transitionPolicies);
}

describe('MoveOpportunityStageExecutor', () => {
  it('calls the canonical command as the automation actor with the expected version', async () => {
    const moveStage = jest
      .fn()
      .mockResolvedValue({ opportunity: { id: 'opportunity-1' } });
    const executor = build(moveStage);

    const result = await executor.execute(request());

    expect(result.status).toBe('confirmed');
    expect(result.effectConfirmed).toBe(true);
    expect(result.reference).toBe('opportunity-1');

    const [ctx, opportunityId, toStageId, options] = moveStage.mock
      .calls[0] as [
      { tenantId: string; workspaceId: string },
      string,
      string,
      Record<string, unknown>,
    ];
    expect(ctx).toEqual({ tenantId: 'tenant-1', workspaceId: 'workspace-1' });
    expect(opportunityId).toBe('opportunity-1');
    expect(toStageId).toBe('stage-2');
    expect(options).toMatchObject({
      actor: { type: 'automation' },
      expectedVersion: 4,
      reason: 'qualified',
      idempotencyKey: 'effect:abc',
    });
  });

  it('refuses without a configured destination and never calls the command', async () => {
    const moveStage = jest.fn();
    const executor = build(moveStage);

    const result = await executor.execute(
      request({
        payload: {
          opportunityId: 'opportunity-1',
          toStageId: null,
          reasonCode: 'qualified',
        },
      }),
    );

    expect(result.status).toBe('refused');
    expect(result.errorCode).toBe('stage_transition_requirements_not_met');
    expect(moveStage).not.toHaveBeenCalled();
  });

  it('resolves a CRM-managed destination when the automation has no duplicated target', async () => {
    const moveStage = jest
      .fn()
      .mockResolvedValue({ opportunity: { id: 'opportunity-1' } });
    const resolve = jest.fn().mockResolvedValue({
      toStageId: 'stage-from-crm-rule',
      reasonCode: 'automatic_stage_advance',
    });
    const executor = build(moveStage, resolve);

    const result = await executor.execute(
      request({
        payload: {
          opportunityId: 'opportunity-1',
          toStageId: null,
          reasonCode: null,
        },
      }),
    );

    expect(result.status).toBe('confirmed');
    expect(resolve).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
      'opportunity-1',
    );
    expect(moveStage).toHaveBeenCalledWith(
      expect.any(Object),
      'opportunity-1',
      'stage-from-crm-rule',
      expect.objectContaining({ reason: 'automatic_stage_advance' }),
    );
  });

  it('treats a governed refusal as refused, not failed, and does not retry', async () => {
    const moveStage = jest.fn().mockRejectedValue(
      new ConflictException({
        code: 'CRM_STAGE_TRANSITION_BLOCKED',
        reasonCode: 'automatic_terminal_transition',
        message: 'Automatic terminal transitions are disabled.',
      }),
    );
    const executor = build(moveStage);

    const result = await executor.execute(request());

    expect(result.status).toBe('refused');
    expect(result.effectConfirmed).toBe(false);
    expect(result.errorClass).toBe(LeadFlowAutomationErrorClass.Permanent);
    expect(result.errorCode).toBe('automatic_terminal_transition');
  });

  it('treats a stale version as a refusal', async () => {
    const moveStage = jest.fn().mockRejectedValue(
      new ConflictException({
        code: 'CRM_OPPORTUNITY_VERSION_CONFLICT',
        message: 'Opportunity was changed by another request.',
      }),
    );
    const executor = build(moveStage);

    const result = await executor.execute(request());

    expect(result.status).toBe('refused');
    expect(result.errorCode).toBe('CRM_OPPORTUNITY_VERSION_CONFLICT');
  });

  it('treats a missing opportunity as a refusal', async () => {
    const moveStage = jest
      .fn()
      .mockRejectedValue(new NotFoundException('gone'));
    const executor = build(moveStage);

    const result = await executor.execute(request());

    expect(result.status).toBe('refused');
    expect(result.errorCode).toBe('opportunity_not_found');
  });

  it('treats an unexpected error as a transient failure worth retrying', async () => {
    const moveStage = jest
      .fn()
      .mockRejectedValue(new Error('connection reset'));
    const executor = build(moveStage);

    const result = await executor.execute(request());

    expect(result.status).toBe('failed');
    expect(result.errorClass).toBe(LeadFlowAutomationErrorClass.Transient);
    // No provider detail leaks into the sanitized message.
    expect(result.errorMessage).not.toContain('connection reset');
  });
});
