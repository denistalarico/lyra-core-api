import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { PlatformPermissionService } from '../../permissions';
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
  LeadFlowAutomationErrorClass,
  LeadFlowAutomationRunMode,
  LeadFlowAutomationRunStatus,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationVersionStatus } from '../enums/leadflow-automation-version-status.enum';
import { LEADFLOW_AUTOMATIONS_PERMISSIONS } from '../leadflow-automations.permissions';
import type {
  LeadFlowAutomationCrmPolicy,
  LeadFlowAutomationRuntimeContract,
  LeadFlowJsonObject,
} from '../types/leadflow-automation.types';
import type { LeadFlowAutomationRunWithAttempts } from './leadflow-automation-run.service';

const UPDATE_PERMISSIONS = [
  'leadflow.crm.records.update.assigned',
  'leadflow.crm.records.update.client',
];
const CREATE_PERMISSION = 'leadflow.crm.records.create.client';

type ExecutionFacts = {
  automation: LeadFlowAutomationEntity;
  version: LeadFlowAutomationVersionEntity;
  correlationId: string;
  crmIdempotencyKey: string;
  effectRequested: LeadFlowJsonObject;
};

/**
 * Executes the CRM effects that became canonical in the governed CRM sprint.
 *
 * This service is intentionally not an event consumer or scheduler. It is the
 * narrow execution boundary those future runtimes may call: it pins a
 * published version, checks the initiating user's permissions, records a live
 * run and delegates every write to CrmOpportunityCommandService.
 */
@Injectable()
export class LeadFlowAutomationCrmActionService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly opportunityCommands: CrmOpportunityCommandService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  async execute(
    ctx: RequestContext,
    automationId: string,
    dto: ExecuteCrmAutomationActionDto,
    idempotencyKey: string | undefined,
  ): Promise<LeadFlowAutomationRunWithAttempts> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    await this.assertActorPermissions(ctx, dto);

    let facts: ExecutionFacts | null = null;
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockExecution(manager, ctx, key);
        const automation = await this.findScopedAutomation(
          manager,
          ctx,
          automationId,
        );
        const replay = await this.findRunByKey(
          manager,
          ctx,
          key,
          automation.id,
        );
        if (replay) return replay;

        this.assertExecutableAutomation(automation);
        const version = await this.findPinnedVersion(manager, automation, dto);
        this.assertPublishedAction(version, dto);

        const correlationId = dto.correlationId ?? randomUUID();
        const crmIdempotencyKey = this.crmIdempotencyKey(
          automation.id,
          key,
          dto.action,
        );
        const effectRequested = this.effectSnapshot(dto);
        facts = {
          automation,
          version,
          correlationId,
          crmIdempotencyKey,
          effectRequested,
        };

        const now = new Date();
        const runRepository = manager.getRepository(
          LeadFlowAutomationRunEntity,
        );
        const attemptRepository = manager.getRepository(
          LeadFlowAutomationRunAttemptEntity,
        );
        const run = await runRepository.save(
          runRepository.create({
            tenantId: automation.tenantId,
            workspaceId: automation.workspaceId,
            automationId: automation.id,
            automationVersionId: version.id,
            recipeKey: automation.recipeKey,
            templateVersion: automation.templateVersion,
            mode: LeadFlowAutomationRunMode.Live,
            status: LeadFlowAutomationRunStatus.Running,
            skipReason: null,
            triggerType:
              (automation.triggerConfig?.type as string) ?? 'runtime.requested',
            triggerKind: dto.sourceEventId ? 'event' : 'manual',
            sourceEventId: dto.sourceEventId ?? null,
            sourceEventName:
              dto.sourceEventName ?? 'automation.crm_action_requested',
            correlationId,
            causationId: dto.causationId ?? dto.sourceEventId ?? null,
            idempotencyKey: key,
            inputSnapshot: {
              opportunityId: dto.opportunityId,
              expectedVersion: dto.expectedVersion,
              automationVersionId: version.id,
              sourceEventId: dto.sourceEventId ?? null,
            },
            result: { action: dto.action, status: 'running' },
            errorCode: null,
            errorMessage: null,
            attemptCount: 1,
            scheduledAt: null,
            startedAt: now,
            finishedAt: null,
            createdById: ctx.userId ?? null,
          }),
        );
        const attempt = await attemptRepository.save(
          attemptRepository.create({
            tenantId: automation.tenantId,
            workspaceId: automation.workspaceId,
            runId: run.id,
            attemptNumber: 1,
            actionKey: dto.action,
            status: LeadFlowAutomationAttemptStatus.Running,
            errorClass: null,
            errorCode: null,
            errorMessage: null,
            effectRequested,
            effectConfirmed: false,
            durationMs: null,
            startedAt: now,
            finishedAt: null,
          }),
        );

        const result = await this.executeCanonicalCommand(
          manager,
          ctx,
          run.id,
          dto,
          facts,
        );
        const finishedAt = new Date();
        attempt.status = LeadFlowAutomationAttemptStatus.Succeeded;
        attempt.effectConfirmed = true;
        attempt.finishedAt = finishedAt;
        attempt.durationMs = Math.max(0, finishedAt.getTime() - now.getTime());
        run.status = LeadFlowAutomationRunStatus.Succeeded;
        run.result = {
          action: dto.action,
          status: 'succeeded',
          sourceOpportunityId: dto.opportunityId,
          resultOpportunityId: result.id,
          rowVersion: result.rowVersion,
        };
        run.finishedAt = finishedAt;
        await attemptRepository.save(attempt);
        await runRepository.save(run);
        return { run, attempts: [attempt] };
      });
    } catch (error) {
      if (!facts) throw error;
      return this.recordFailure(ctx, dto, key, facts, error);
    }
  }

  private async executeCanonicalCommand(
    manager: EntityManager,
    ctx: RequestContext,
    runId: string,
    dto: ExecuteCrmAutomationActionDto,
    facts: ExecutionFacts,
  ) {
    const options = {
      actor: { type: 'automation' as const, userId: ctx.userId ?? null },
      expectedVersion: dto.expectedVersion,
      expectedTransitionPolicyId: dto.expectedTransitionPolicyId,
      expectedTransitionPolicyVersion: dto.expectedTransitionPolicyVersion,
      idempotencyKey: facts.crmIdempotencyKey,
      correlationId: facts.correlationId,
      causationId: dto.causationId ?? dto.sourceEventId ?? null,
      reason: dto.reasonCode,
      metadata: {
        source: 'leadflow_automation',
        automationId: facts.automation.id,
        automationVersionId: facts.version.id,
        automationRunId: runId,
        initiatingUserId: ctx.userId ?? null,
        sourceEventId: dto.sourceEventId ?? null,
        sourceEventName: dto.sourceEventName ?? null,
      },
    };

    if (dto.action === LeadFlowAutomationCrmAction.MoveStage) {
      const result = await this.opportunityCommands.moveStageWithinTransaction(
        manager,
        ctx,
        dto.opportunityId,
        dto.stageId,
        options,
      );
      return result.opportunity;
    }

    if (dto.action === LeadFlowAutomationCrmAction.TransferPipeline) {
      const result =
        await this.opportunityCommands.transferPipelineWithinTransaction(
          manager,
          ctx,
          dto.opportunityId,
          dto.pipelineId as string,
          dto.stageId,
          { ...options, transferMode: 'automation' },
        );
      return result.opportunity;
    }

    return this.opportunityCommands.copyOpportunityWithinTransaction(
      manager,
      ctx,
      dto.opportunityId,
      {
        pipelineId: dto.pipelineId as string,
        stageId: dto.stageId,
      },
      options,
    );
  }

  private async assertActorPermissions(
    ctx: RequestContext,
    dto: ExecuteCrmAutomationActionDto,
  ): Promise<void> {
    if (!ctx.userId || !ctx.role || !ctx.workspaceId) {
      throw new ForbiddenException(
        'Automation CRM actions require an initiating user and workspace.',
      );
    }
    const permissionContext = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      role: ctx.role,
    };
    const entitled = await this.permissionService.canAccessProduct(
      permissionContext,
      'leadflow',
    );
    if (!entitled) {
      throw new ForbiddenException('LeadFlow entitlement is required.');
    }
    await this.permissionService.assertCan(
      permissionContext,
      LEADFLOW_AUTOMATIONS_PERMISSIONS.execute,
    );

    const scopeRequest = {
      method:
        dto.action === LeadFlowAutomationCrmAction.MoveStage ? 'PATCH' : 'POST',
      routePath:
        dto.action === LeadFlowAutomationCrmAction.MoveStage
          ? 'crm/opportunities/:id/stage'
          : dto.action === LeadFlowAutomationCrmAction.TransferPipeline
            ? 'crm/opportunities/:id/transfer'
            : 'crm/opportunities/:id/copy',
      params: { id: dto.opportunityId },
      body: dto as unknown as Record<string, unknown>,
    };
    if (dto.action === LeadFlowAutomationCrmAction.CopyOpportunity) {
      await this.permissionService.assertCan(
        permissionContext,
        CREATE_PERMISSION,
        scopeRequest,
      );
      return;
    }
    await this.permissionService.assertAny(
      permissionContext,
      UPDATE_PERMISSIONS,
      scopeRequest,
    );
  }

  private async findScopedAutomation(
    manager: EntityManager,
    ctx: RequestContext,
    automationId: string,
  ): Promise<LeadFlowAutomationEntity> {
    const clientId =
      ctx.managedContext?.operatingMode === 'client'
        ? ctx.managedContext.clientId
        : null;
    const automation = await manager
      .getRepository(LeadFlowAutomationEntity)
      .findOne({
        where: {
          id: automationId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId as string,
          contextType: clientId
            ? LeadFlowSettingsContextType.Client
            : LeadFlowSettingsContextType.Agency,
          agencyClientId: clientId ?? IsNull(),
        },
        lock: { mode: 'pessimistic_read' },
      });
    if (!automation) {
      throw new NotFoundException('Automação não encontrada neste contexto.');
    }
    return automation;
  }

  private assertExecutableAutomation(
    automation: LeadFlowAutomationEntity,
  ): void {
    if (automation.status !== LeadFlowAutomationStatus.Active) {
      throw new BadRequestException({
        code: 'AUTOMATION_NOT_ACTIVE',
        message: 'Somente uma automação ativa pode executar efeitos reais.',
      });
    }
    if (!automation.publishedVersionId) {
      throw new BadRequestException({
        code: 'AUTOMATION_NOT_PUBLISHED',
        message: 'Publique a automação antes de executar efeitos reais.',
      });
    }
  }

  private async findPinnedVersion(
    manager: EntityManager,
    automation: LeadFlowAutomationEntity,
    dto: ExecuteCrmAutomationActionDto,
  ): Promise<LeadFlowAutomationVersionEntity> {
    if (automation.publishedVersionId !== dto.automationVersionId) {
      throw new BadRequestException({
        code: 'AUTOMATION_VERSION_STALE',
        message: 'A versão publicada mudou antes da execução.',
      });
    }
    const version = await manager
      .getRepository(LeadFlowAutomationVersionEntity)
      .findOne({
        where: {
          id: dto.automationVersionId,
          tenantId: automation.tenantId,
          automationId: automation.id,
          status: LeadFlowAutomationVersionStatus.Published,
        },
      });
    if (!version) {
      throw new BadRequestException({
        code: 'AUTOMATION_VERSION_NOT_PUBLISHED',
        message: 'A versão solicitada não é uma publicação válida.',
      });
    }
    return version;
  }

  private assertPublishedAction(
    version: LeadFlowAutomationVersionEntity,
    dto: ExecuteCrmAutomationActionDto,
  ): void {
    const snapshot = version.snapshot as LeadFlowAutomationRuntimeContract;
    const policy: LeadFlowAutomationCrmPolicy = snapshot.crmPolicy ?? {};
    const matches =
      dto.action === LeadFlowAutomationCrmAction.MoveStage
        ? policy.moveStageOnComplete === dto.stageId &&
          policy.moveStageReasonCode === dto.reasonCode
        : dto.action === LeadFlowAutomationCrmAction.TransferPipeline
          ? policy.transferToPipelineRef === dto.pipelineId &&
            policy.transferToStageRef === dto.stageId &&
            policy.transferReasonCode === dto.reasonCode
          : policy.copyToPipelineRef === dto.pipelineId &&
            policy.copyToStageRef === dto.stageId &&
            policy.copyReasonCode === dto.reasonCode;
    if (!matches) {
      throw new BadRequestException({
        code: 'AUTOMATION_ACTION_NOT_PUBLISHED',
        message:
          'A ação, o destino e o motivo precisam coincidir com a versão publicada.',
      });
    }
  }

  private async recordFailure(
    ctx: RequestContext,
    dto: ExecuteCrmAutomationActionDto,
    key: string,
    facts: ExecutionFacts,
    error: unknown,
  ): Promise<LeadFlowAutomationRunWithAttempts> {
    const failure = this.sanitizeError(error);
    return this.dataSource.transaction(async (manager) => {
      await this.lockExecution(manager, ctx, key);
      const replay = await this.findRunByKey(
        manager,
        ctx,
        key,
        facts.automation.id,
      );
      if (replay) return replay;

      const now = new Date();
      const runRepository = manager.getRepository(LeadFlowAutomationRunEntity);
      const attemptRepository = manager.getRepository(
        LeadFlowAutomationRunAttemptEntity,
      );
      const run = await runRepository.save(
        runRepository.create({
          tenantId: facts.automation.tenantId,
          workspaceId: facts.automation.workspaceId,
          automationId: facts.automation.id,
          automationVersionId: facts.version.id,
          recipeKey: facts.automation.recipeKey,
          templateVersion: facts.automation.templateVersion,
          mode: LeadFlowAutomationRunMode.Live,
          status: LeadFlowAutomationRunStatus.Failed,
          skipReason: null,
          triggerType:
            (facts.automation.triggerConfig?.type as string) ??
            'runtime.requested',
          triggerKind: dto.sourceEventId ? 'event' : 'manual',
          sourceEventId: dto.sourceEventId ?? null,
          sourceEventName:
            dto.sourceEventName ?? 'automation.crm_action_requested',
          correlationId: facts.correlationId,
          causationId: dto.causationId ?? dto.sourceEventId ?? null,
          idempotencyKey: key,
          inputSnapshot: {
            opportunityId: dto.opportunityId,
            expectedVersion: dto.expectedVersion,
            automationVersionId: facts.version.id,
            sourceEventId: dto.sourceEventId ?? null,
          },
          result: { action: dto.action, status: 'failed' },
          errorCode: failure.code,
          errorMessage: failure.message,
          attemptCount: 1,
          scheduledAt: null,
          startedAt: now,
          finishedAt: now,
          createdById: ctx.userId ?? null,
        }),
      );
      const attempt = await attemptRepository.save(
        attemptRepository.create({
          tenantId: facts.automation.tenantId,
          workspaceId: facts.automation.workspaceId,
          runId: run.id,
          attemptNumber: 1,
          actionKey: dto.action,
          status: LeadFlowAutomationAttemptStatus.Failed,
          errorClass: failure.errorClass,
          errorCode: failure.code,
          errorMessage: failure.message,
          effectRequested: facts.effectRequested,
          effectConfirmed: false,
          durationMs: 0,
          startedAt: now,
          finishedAt: now,
        }),
      );
      return { run, attempts: [attempt] };
    });
  }

  private async findRunByKey(
    manager: EntityManager,
    ctx: RequestContext,
    key: string,
    automationId: string,
  ): Promise<LeadFlowAutomationRunWithAttempts | null> {
    const run = await manager
      .getRepository(LeadFlowAutomationRunEntity)
      .findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId as string,
          idempotencyKey: key,
        },
      });
    if (!run) return null;
    if (run.automationId !== automationId) {
      throw new ConflictException({
        code: 'AUTOMATION_IDEMPOTENCY_KEY_CONFLICT',
        message: 'A chave de idempotência já pertence a outra automação.',
      });
    }
    const attempts = await manager
      .getRepository(LeadFlowAutomationRunAttemptEntity)
      .find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId as string,
          runId: run.id,
        },
        order: { attemptNumber: 'ASC' },
      });
    return { run, attempts };
  }

  private lockExecution(
    manager: EntityManager,
    ctx: RequestContext,
    key: string,
  ): Promise<unknown> {
    return manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${ctx.tenantId}:${ctx.workspaceId}:${key}`],
    );
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key || key.length > 180) {
      throw new BadRequestException({
        code: 'AUTOMATION_IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key é obrigatório e aceita até 180 caracteres.',
      });
    }
    return key;
  }

  private crmIdempotencyKey(
    automationId: string,
    key: string,
    action: LeadFlowAutomationCrmAction,
  ): string {
    const digest = createHash('sha256').update(key).digest('hex');
    return `lfauto:${automationId}:${action}:${digest}`;
  }

  private effectSnapshot(
    dto: ExecuteCrmAutomationActionDto,
  ): LeadFlowJsonObject {
    return {
      action: dto.action,
      opportunityId: dto.opportunityId,
      pipelineId: dto.pipelineId ?? null,
      stageId: dto.stageId,
      expectedVersion: dto.expectedVersion,
      reasonCode: dto.reasonCode,
      automationVersionId: dto.automationVersionId,
    };
  }

  private sanitizeError(error: unknown): {
    code: string;
    message: string;
    errorClass: LeadFlowAutomationErrorClass;
  } {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const body =
        typeof response === 'object' && response !== null
          ? (response as Record<string, unknown>)
          : {};
      const code = this.safeErrorString(
        body.code ?? body.reasonCode,
        error.name,
        80,
      );
      const message = this.safeErrorString(body.message, error.message, 500);
      return {
        code,
        message,
        errorClass:
          error.getStatus() >= 500
            ? LeadFlowAutomationErrorClass.Transient
            : LeadFlowAutomationErrorClass.Permanent,
      };
    }
    return {
      code: 'AUTOMATION_CRM_ACTION_FAILED',
      message: 'A ação CRM falhou sem confirmar efeito.',
      errorClass: LeadFlowAutomationErrorClass.Transient,
    };
  }

  private safeErrorString(
    value: unknown,
    fallback: string,
    maxLength: number,
  ): string {
    return (typeof value === 'string' ? value : fallback).slice(0, maxLength);
  }
}
