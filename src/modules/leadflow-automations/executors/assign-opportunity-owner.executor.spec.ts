import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import type { AutomationEffectRequest } from './automation-executor.types';
import { AssignOpportunityOwnerExecutor } from './assign-opportunity-owner.executor';

function request(
  overrides: Partial<AutomationEffectRequest> = {},
): AutomationEffectRequest {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    runId: 'event-1',
    attemptNumber: 1,
    actionKey: 'assign_opportunity_owner',
    correlationId: 'event-1',
    idempotencyKey: 'effect:abc',
    actorRef: 'automation:automation-1',
    policyRef: 'lead_distribution:version-1',
    payload: {
      opportunityId: 'opportunity-1',
      strategy: 'least_volume',
      channelMap: null,
      fallbackUserId: null,
    },
    revalidation: {
      contextSchemaVersion: 1,
      capturedAt: '2026-07-24T12:00:00Z',
      subjects: { crm_opportunity: 'opportunity-1' },
      expectedVersion: 4,
    },
    ...overrides,
  };
}

function build(distributeOpportunityOwner: jest.Mock) {
  const crmCommand = {
    distributeOpportunityOwner,
  } as unknown as CrmOpportunityCommandService;
  return new AssignOpportunityOwnerExecutor(crmCommand);
}

describe('AssignOpportunityOwnerExecutor', () => {
  it('calls the canonical command as the automation actor with the expected version', async () => {
    const distribute = jest.fn().mockResolvedValue({
      opportunity: { id: 'opportunity-1' },
      assignedUserId: 'user-b',
      reasonCode: 'least_volume',
    });
    const executor = build(distribute);

    const result = await executor.execute(request());

    expect(result.status).toBe('confirmed');
    expect(result.effectConfirmed).toBe(true);
    expect(result.reference).toBe('user-b');

    const [ctx, opportunityId, config, options] = distribute.mock.calls[0] as [
      { tenantId: string; workspaceId: string },
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(ctx).toEqual({ tenantId: 'tenant-1', workspaceId: 'workspace-1' });
    expect(opportunityId).toBe('opportunity-1');
    expect(config).toMatchObject({ strategy: 'least_volume' });
    expect(options).toMatchObject({
      actor: { type: 'automation' },
      expectedVersion: 4,
      idempotencyKey: 'effect:abc',
    });
  });

  it('defaults an unknown strategy to least_volume', async () => {
    const distribute = jest.fn().mockResolvedValue({
      opportunity: { id: 'opportunity-1' },
      assignedUserId: 'user-a',
      reasonCode: 'least_volume',
    });
    const executor = build(distribute);

    await executor.execute(
      request({
        payload: { opportunityId: 'opportunity-1', strategy: 'made_up' },
      }),
    );

    expect(distribute.mock.calls[0][2]).toMatchObject({
      strategy: 'least_volume',
    });
  });

  it('refuses without a target opportunity and never calls the command', async () => {
    const distribute = jest.fn();
    const executor = build(distribute);

    const result = await executor.execute(
      request({ payload: { opportunityId: null, strategy: 'least_volume' } }),
    );

    expect(result.status).toBe('refused');
    expect(result.errorCode).toBe('lead_distribution_unconfigured');
    expect(distribute).not.toHaveBeenCalled();
  });

  it('treats an already-assigned refusal as refused, not failed', async () => {
    const distribute = jest.fn().mockRejectedValue(
      new ConflictException({
        code: 'CRM_LEAD_DISTRIBUTION_BLOCKED',
        reasonCode: 'already_assigned',
        message: 'A oportunidade já possui um responsável.',
      }),
    );
    const executor = build(distribute);

    const result = await executor.execute(request());

    expect(result.status).toBe('refused');
    expect(result.effectConfirmed).toBe(false);
    expect(result.errorClass).toBe(LeadFlowAutomationErrorClass.Permanent);
    expect(result.errorCode).toBe('already_assigned');
  });

  it('treats a missing opportunity as a refusal', async () => {
    const distribute = jest
      .fn()
      .mockRejectedValue(new NotFoundException('gone'));
    const executor = build(distribute);

    const result = await executor.execute(request());

    expect(result.status).toBe('refused');
    expect(result.errorCode).toBe('opportunity_not_found');
  });

  it('treats an unexpected error as a transient failure worth retrying', async () => {
    const distribute = jest
      .fn()
      .mockRejectedValue(new Error('connection reset'));
    const executor = build(distribute);

    const result = await executor.execute(request());

    expect(result.status).toBe('failed');
    expect(result.errorClass).toBe(LeadFlowAutomationErrorClass.Transient);
    expect(result.errorMessage).not.toContain('connection reset');
  });
});
