/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/unbound-method -- Jest/TypeORM test doubles intentionally expose partial dynamic repository shapes. */
import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import type { PlatformPermissionService } from '../../permissions';
import {
  ExecuteCrmAutomationActionDto,
  LeadFlowAutomationCrmAction,
} from '../dto/execute-crm-automation-action.dto';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationRunAttemptEntity,
  LeadFlowAutomationRunEntity,
  LeadFlowAutomationVersionEntity,
} from '../entities';
import {
  LeadFlowAutomationAttemptStatus,
  LeadFlowAutomationRunStatus,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationVersionStatus } from '../enums/leadflow-automation-version-status.enum';
import { LEADFLOW_AUTOMATIONS_PERMISSIONS } from '../leadflow-automations.permissions';
import { LeadFlowAutomationCrmActionService } from './leadflow-automation-crm-action.service';

const ids = {
  tenant: '10000000-0000-4000-8000-000000000001',
  workspace: '10000000-0000-4000-8000-000000000002',
  user: '10000000-0000-4000-8000-000000000003',
  automation: '10000000-0000-4000-8000-000000000004',
  version: '10000000-0000-4000-8000-000000000005',
  opportunity: '10000000-0000-4000-8000-000000000006',
  pipeline: '10000000-0000-4000-8000-000000000007',
  stage: '10000000-0000-4000-8000-000000000008',
};

const ctx: RequestContext = {
  tenantId: ids.tenant,
  workspaceId: ids.workspace,
  userId: ids.user,
  role: 'admin',
};

function dto(
  action: LeadFlowAutomationCrmAction,
): ExecuteCrmAutomationActionDto {
  return {
    action,
    opportunityId: ids.opportunity,
    automationVersionId: ids.version,
    pipelineId:
      action === LeadFlowAutomationCrmAction.MoveStage
        ? undefined
        : ids.pipeline,
    stageId: ids.stage,
    expectedVersion: 3,
    reasonCode: `${action}_approved`,
  };
}

function harness(action: LeadFlowAutomationCrmAction) {
  const request = dto(action);
  const automation = {
    id: ids.automation,
    tenantId: ids.tenant,
    workspaceId: ids.workspace,
    contextType: 'agency',
    agencyClientId: null,
    recipeKey: 'followup_idle_lead',
    templateVersion: 2,
    status: LeadFlowAutomationStatus.Active,
    publishedVersionId: ids.version,
    triggerConfig: { type: 'conversation.idle' },
  } as LeadFlowAutomationEntity;
  const version = {
    id: ids.version,
    tenantId: ids.tenant,
    automationId: ids.automation,
    status: LeadFlowAutomationVersionStatus.Published,
    snapshot: {
      crmPolicy: {
        moveStageOnComplete: ids.stage,
        moveStageReasonCode: `${LeadFlowAutomationCrmAction.MoveStage}_approved`,
        transferToPipelineRef: ids.pipeline,
        transferToStageRef: ids.stage,
        transferReasonCode: `${LeadFlowAutomationCrmAction.TransferPipeline}_approved`,
        copyToPipelineRef: ids.pipeline,
        copyToStageRef: ids.stage,
        copyReasonCode: `${LeadFlowAutomationCrmAction.CopyOpportunity}_approved`,
      },
    },
  } as LeadFlowAutomationVersionEntity;

  let currentRun: LeadFlowAutomationRunEntity | null = null;
  let currentAttempts: LeadFlowAutomationRunAttemptEntity[] = [];
  let runSequence = 0;
  const runRepository = {
    findOne: jest.fn(async () => currentRun),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      currentRun = {
        id: value.id ?? `run-${++runSequence}`,
        createdAt: value.createdAt ?? new Date(),
        updatedAt: value.updatedAt ?? new Date(),
        ...value,
      } as LeadFlowAutomationRunEntity;
      return currentRun;
    }),
  };
  const attemptRepository = {
    find: jest.fn(async () => currentAttempts),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      const attempt = {
        id: value.id ?? `attempt-${currentAttempts.length + 1}`,
        createdAt: value.createdAt ?? new Date(),
        ...value,
      } as LeadFlowAutomationRunAttemptEntity;
      currentAttempts = [attempt];
      return attempt;
    }),
  };
  const automationRepository = {
    findOne: jest.fn(async () => automation),
  };
  const versionRepository = { findOne: jest.fn(async () => version) };
  const manager = {
    query: jest.fn(async () => []),
    getRepository: jest.fn((entity) => {
      if (entity === LeadFlowAutomationEntity) return automationRepository;
      if (entity === LeadFlowAutomationVersionEntity) return versionRepository;
      if (entity === LeadFlowAutomationRunEntity) return runRepository;
      if (entity === LeadFlowAutomationRunAttemptEntity)
        return attemptRepository;
      throw new Error('Unexpected repository');
    }),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn(async (work: (manager: EntityManager) => unknown) => {
      const runBefore = currentRun;
      const attemptsBefore = currentAttempts;
      try {
        return await work(manager);
      } catch (error) {
        currentRun = runBefore;
        currentAttempts = attemptsBefore;
        throw error;
      }
    }),
  } as unknown as DataSource;
  const commands = {
    moveStageWithinTransaction: jest.fn(async () => ({
      opportunity: { id: ids.opportunity, rowVersion: 4 },
      event: {},
    })),
    transferPipelineWithinTransaction: jest.fn(async () => ({
      opportunity: { id: ids.opportunity, rowVersion: 4 },
      event: {},
    })),
    copyOpportunityWithinTransaction: jest.fn(async () => ({
      id: '10000000-0000-4000-8000-000000000009',
      rowVersion: 1,
    })),
  } as unknown as jest.Mocked<CrmOpportunityCommandService>;
  const permissions = {
    canAccessProduct: jest.fn(async () => true),
    assertCan: jest.fn(async () => undefined),
    assertAny: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<PlatformPermissionService>;
  const service = new LeadFlowAutomationCrmActionService(
    dataSource,
    commands,
    permissions,
  );

  return {
    request,
    automation,
    version,
    runRepository,
    commands,
    permissions,
    service,
    setRun(run: LeadFlowAutomationRunEntity, attempts = []) {
      currentRun = run;
      currentAttempts = attempts;
    },
  };
}

describe('LeadFlowAutomationCrmActionService', () => {
  it('moves a stage through the canonical command with automation actor and audit metadata', async () => {
    const h = harness(LeadFlowAutomationCrmAction.MoveStage);

    const result = await h.service.execute(
      ctx,
      ids.automation,
      h.request,
      'event-1:move',
    );

    expect(h.commands.moveStageWithinTransaction).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      ids.opportunity,
      ids.stage,
      expect.objectContaining({
        actor: { type: 'automation', userId: ids.user },
        expectedVersion: 3,
        reason: 'move_opportunity_stage_approved',
        metadata: expect.objectContaining({
          automationId: ids.automation,
          automationVersionId: ids.version,
          initiatingUserId: ids.user,
        }),
      }),
    );
    expect(result.run.status).toBe(LeadFlowAutomationRunStatus.Succeeded);
    expect(result.attempts[0]).toMatchObject({
      status: LeadFlowAutomationAttemptStatus.Succeeded,
      effectConfirmed: true,
    });
    expect(h.permissions.assertAny).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ids.user }),
      expect.arrayContaining(['leadflow.crm.records.update.assigned']),
      expect.objectContaining({ params: { id: ids.opportunity } }),
    );
  });

  it.each([
    [
      LeadFlowAutomationCrmAction.TransferPipeline,
      'transferPipelineWithinTransaction',
    ],
    [
      LeadFlowAutomationCrmAction.CopyOpportunity,
      'copyOpportunityWithinTransaction',
    ],
  ] as const)(
    'delegates %s to the canonical CRM command',
    async (action, method) => {
      const h = harness(action);

      const result = await h.service.execute(
        ctx,
        ids.automation,
        h.request,
        `event-2:${action}`,
      );

      expect(h.commands[method]).toHaveBeenCalledTimes(1);
      expect(result.run.status).toBe(LeadFlowAutomationRunStatus.Succeeded);
      if (action === LeadFlowAutomationCrmAction.CopyOpportunity) {
        expect(h.permissions.assertCan).toHaveBeenCalledWith(
          expect.anything(),
          'leadflow.crm.records.create.client',
          expect.anything(),
        );
      }
    },
  );

  it('fails closed when target or reason differs from the published version', async () => {
    const h = harness(LeadFlowAutomationCrmAction.TransferPipeline);
    h.request.reasonCode = 'invented_reason';

    await expect(
      h.service.execute(ctx, ids.automation, h.request, 'event-3:transfer'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AUTOMATION_ACTION_NOT_PUBLISHED',
      }),
    });
    expect(h.commands.transferPipelineWithinTransaction).not.toHaveBeenCalled();
  });

  it('records a failed live run when the canonical policy rejects the action', async () => {
    const h = harness(LeadFlowAutomationCrmAction.MoveStage);
    h.commands.moveStageWithinTransaction.mockRejectedValueOnce(
      new ConflictException({
        code: 'CRM_STAGE_TRANSITION_BLOCKED',
        reasonCode: 'transition_policy_stale',
        message: 'Published policy changed.',
      }),
    );

    const result = await h.service.execute(
      ctx,
      ids.automation,
      h.request,
      'event-4:move',
    );

    expect(result.run).toMatchObject({
      status: LeadFlowAutomationRunStatus.Failed,
      errorCode: 'CRM_STAGE_TRANSITION_BLOCKED',
    });
    expect(result.attempts[0]).toMatchObject({
      status: LeadFlowAutomationAttemptStatus.Failed,
      effectConfirmed: false,
      errorCode: 'CRM_STAGE_TRANSITION_BLOCKED',
    });
  });

  it('returns an existing run for the same scoped idempotency key', async () => {
    const h = harness(LeadFlowAutomationCrmAction.CopyOpportunity);
    const existing = {
      id: 'run-existing',
      tenantId: ids.tenant,
      workspaceId: ids.workspace,
      automationId: ids.automation,
      idempotencyKey: 'same-key',
      status: LeadFlowAutomationRunStatus.Succeeded,
    } as LeadFlowAutomationRunEntity;
    h.setRun(existing);

    const result = await h.service.execute(
      ctx,
      ids.automation,
      h.request,
      'same-key',
    );

    expect(result.run).toBe(existing);
    expect(h.commands.copyOpportunityWithinTransaction).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key already owned by another automation', async () => {
    const h = harness(LeadFlowAutomationCrmAction.CopyOpportunity);
    h.setRun({
      id: 'run-existing',
      tenantId: ids.tenant,
      workspaceId: ids.workspace,
      automationId: '10000000-0000-4000-8000-000000000099',
      idempotencyKey: 'conflicting-key',
      status: LeadFlowAutomationRunStatus.Succeeded,
    } as LeadFlowAutomationRunEntity);

    await expect(
      h.service.execute(ctx, ids.automation, h.request, 'conflicting-key'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'AUTOMATION_IDEMPOTENCY_KEY_CONFLICT',
      }),
    });
  });

  it('checks the automation execution permission before the domain permission', async () => {
    const h = harness(LeadFlowAutomationCrmAction.MoveStage);

    await h.service.execute(ctx, ids.automation, h.request, 'event-5:move');

    expect(h.permissions.assertCan).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ userId: ids.user }),
      LEADFLOW_AUTOMATIONS_PERMISSIONS.execute,
    );
  });
});
