import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Raw } from 'typeorm';
import { RequestContext } from '../../../common/context/request-context.interface';
import {
  CreateCrmStageTransitionPolicyDto,
  PatchCrmStageTransitionPolicyDto,
} from '../dto/crm-stage-transition-policy.dto';
import { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';
import { CrmStageEntity } from '../entities/crm-stage.entity';
import {
  CrmStageTransitionActor,
  CrmStageTransitionCondition,
  CrmStageTransitionConditionContract,
  CrmStageTransitionPolicyEntity,
} from '../entities/crm-stage-transition-policy.entity';
import type { CrmCommandActor } from './crm-opportunity-command.service';

const CANONICAL_FIELDS = new Set([
  'contactId',
  'contactName',
  'contactEmail',
  'contactPhone',
  'title',
  'description',
  'valueAmount',
  'currency',
  'priority',
  'source',
  'businessMode',
  'operationalStatus',
  'assignedUserId',
  'expectedCloseDate',
  'nextFollowUpAt',
  'lastActivityAt',
  'lostReason',
]);

export type CrmAiStageTransitionCatalog = {
  opportunityId: string;
  opportunityRowVersion: number;
  pipelineId: string;
  currentStageId: string;
  currentStageName: string;
  lifecycleStatus: string;
  capabilities: {
    canProposeStageTransition: boolean;
    canApplyTerminalTransition: false;
  };
  destinations: Array<{
    toStageId: string;
    toStageName: string;
    operationMode: CrmStageEntity['operationMode'];
    transitionPolicyId: string;
    transitionPolicyVersion: number;
    reasonCodes: string[];
    requiredFields: string[];
    presentFields: string[];
    missingFields: string[];
    criteria: string[];
    conditionsMet: boolean;
    aiGuidance: string | null;
    currentlyEligible: boolean;
  }>;
};

@Injectable()
export class CrmStageTransitionPolicyService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async list(
    ctx: RequestContext,
    pipelineId: string,
  ): Promise<CrmStageTransitionPolicyEntity[]> {
    return this.dataSource.getRepository(CrmStageTransitionPolicyEntity).find({
      where: {
        tenantId: this.tenantId(ctx),
        workspaceId: this.workspaceId(ctx),
        pipelineId,
        deletedAt: IsNull(),
        ...this.clientScope(ctx),
      },
      order: { fromStageId: 'ASC', toStageId: 'ASC', version: 'DESC' },
    });
  }

  async getAiTransitionCatalog(
    ctx: RequestContext,
    opportunity: CrmOpportunityEntity,
  ): Promise<CrmAiStageTransitionCatalog> {
    if (
      opportunity.tenantId !== this.tenantId(ctx) ||
      opportunity.workspaceId !== this.workspaceId(ctx)
    ) {
      throw new BadRequestException(
        'Opportunity scope does not match transition catalog scope.',
      );
    }
    const [currentStage, policies] = await Promise.all([
      this.dataSource.getRepository(CrmStageEntity).findOne({
        where: {
          id: opportunity.stageId,
          tenantId: opportunity.tenantId,
          workspaceId: opportunity.workspaceId,
          pipelineId: opportunity.pipelineId,
          deletedAt: IsNull(),
        },
      }),
      this.dataSource.getRepository(CrmStageTransitionPolicyEntity).find({
        where: {
          tenantId: opportunity.tenantId,
          workspaceId: opportunity.workspaceId,
          pipelineId: opportunity.pipelineId,
          fromStageId: opportunity.stageId,
          status: 'published',
          deletedAt: IsNull(),
        },
        order: { version: 'DESC' },
      }),
    ]);
    if (!currentStage) {
      throw new NotFoundException('Current CRM stage not found.');
    }
    const aiPolicies = policies.filter((policy) =>
      policy.allowedActors.includes('ai'),
    );
    const targetIds = [
      ...new Set(aiPolicies.map((policy) => policy.toStageId)),
    ];
    const targetStages = targetIds.length
      ? await this.dataSource.getRepository(CrmStageEntity).find({
          where: targetIds.map((id) => ({
            id,
            tenantId: opportunity.tenantId,
            workspaceId: opportunity.workspaceId,
            pipelineId: opportunity.pipelineId,
            deletedAt: IsNull(),
          })),
        })
      : [];
    const targets = new Map(targetStages.map((stage) => [stage.id, stage]));
    const destinations = aiPolicies.flatMap((policy) => {
      const target = targets.get(policy.toStageId);
      if (
        !target ||
        target.operationMode === 'human_managed' ||
        this.isTerminal(target)
      ) {
        return [];
      }
      const presentFields = policy.requiredFields.filter((field) =>
        this.isPresent(this.readField(opportunity, field)),
      );
      const missingFields = policy.requiredFields.filter(
        (field) => !presentFields.includes(field),
      );
      const failedConditions = (policy.conditionContract.all ?? []).filter(
        (condition) => !this.matches(opportunity, condition),
      );
      return [
        {
          toStageId: target.id,
          toStageName: target.name,
          operationMode: target.operationMode,
          transitionPolicyId: policy.id,
          transitionPolicyVersion: policy.version,
          reasonCodes: policy.reasonCodes,
          requiredFields: policy.requiredFields,
          presentFields,
          missingFields,
          criteria: (policy.conditionContract.all ?? []).map((condition) =>
            this.conditionSummary(condition),
          ),
          conditionsMet: failedConditions.length === 0,
          aiGuidance: policy.aiGuidance,
          currentlyEligible:
            opportunity.status === 'open' &&
            missingFields.length === 0 &&
            failedConditions.length === 0,
        },
      ];
    });
    return {
      opportunityId: opportunity.id,
      opportunityRowVersion: opportunity.rowVersion,
      pipelineId: opportunity.pipelineId,
      currentStageId: opportunity.stageId,
      currentStageName: currentStage.name,
      lifecycleStatus: opportunity.status,
      capabilities: {
        canProposeStageTransition: destinations.some(
          (destination) => destination.currentlyEligible,
        ),
        canApplyTerminalTransition: false,
      },
      destinations,
    };
  }

  async createDraft(
    ctx: RequestContext,
    dto: CreateCrmStageTransitionPolicyDto,
  ): Promise<CrmStageTransitionPolicyEntity> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockEdge(
        manager,
        ctx,
        dto.pipelineId,
        dto.fromStageId,
        dto.toStageId,
      );
      const [fromStage, toStage] = await Promise.all([
        this.stage(manager, ctx, dto.pipelineId, dto.fromStageId),
        this.stage(manager, ctx, dto.pipelineId, dto.toStageId),
      ]);
      if (fromStage.id === toStage.id) {
        throw new BadRequestException(
          'Transition source and destination must differ.',
        );
      }
      this.validateContract(
        dto.requiredFields ?? [],
        dto.conditionContract ?? {},
      );
      const repository = manager.getRepository(CrmStageTransitionPolicyEntity);
      const draft = await repository.findOne({
        where: {
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          pipelineId: dto.pipelineId,
          fromStageId: dto.fromStageId,
          toStageId: dto.toStageId,
          status: 'draft',
          deletedAt: IsNull(),
        },
      });
      if (draft) {
        throw new ConflictException({
          code: 'CRM_STAGE_TRANSITION_DRAFT_EXISTS',
          message: 'This transition already has an editable draft.',
          policyId: draft.id,
        });
      }
      const latest = await repository.findOne({
        where: {
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          pipelineId: dto.pipelineId,
          fromStageId: dto.fromStageId,
          toStageId: dto.toStageId,
        },
        order: { version: 'DESC' },
        withDeleted: true,
      });
      return repository.save(
        repository.create({
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          pipelineId: dto.pipelineId,
          fromStageId: dto.fromStageId,
          toStageId: dto.toStageId,
          allowedActors: this.unique(dto.allowedActors),
          requiredFields: this.unique(dto.requiredFields ?? []),
          conditionContract: dto.conditionContract ?? {},
          reasonCodes: this.unique(dto.reasonCodes),
          aiGuidance: dto.aiGuidance?.trim() || null,
          status: 'draft',
          version: (latest?.version ?? 0) + 1,
          publishedAt: null,
          publishedById: null,
          createdById: ctx.userId ?? null,
          supersededByPolicyId: null,
          metadata: ctx.managedContext?.clientId
            ? { clientId: ctx.managedContext.clientId }
            : {},
        }),
      );
    });
  }

  async patchDraft(
    ctx: RequestContext,
    id: string,
    dto: PatchCrmStageTransitionPolicyDto,
  ): Promise<CrmStageTransitionPolicyEntity> {
    return this.dataSource.transaction(async (manager) => {
      const policy = await this.policy(manager, ctx, id, true);
      this.assertDraft(policy);
      const requiredFields = dto.requiredFields ?? policy.requiredFields;
      const conditionContract =
        dto.conditionContract ?? policy.conditionContract;
      this.validateContract(requiredFields, conditionContract);
      if (dto.allowedActors !== undefined)
        policy.allowedActors = this.unique(dto.allowedActors);
      if (dto.requiredFields !== undefined)
        policy.requiredFields = this.unique(dto.requiredFields);
      if (dto.conditionContract !== undefined)
        policy.conditionContract = dto.conditionContract;
      if (dto.reasonCodes !== undefined)
        policy.reasonCodes = this.unique(dto.reasonCodes);
      if (dto.aiGuidance !== undefined)
        policy.aiGuidance = dto.aiGuidance?.trim() || null;
      return manager.getRepository(CrmStageTransitionPolicyEntity).save(policy);
    });
  }

  async publish(
    ctx: RequestContext,
    id: string,
  ): Promise<CrmStageTransitionPolicyEntity> {
    return this.dataSource.transaction(async (manager) => {
      const policy = await this.policy(manager, ctx, id, true);
      this.assertDraft(policy);
      await this.lockEdge(
        manager,
        ctx,
        policy.pipelineId,
        policy.fromStageId,
        policy.toStageId,
      );
      const toStage = await this.stage(
        manager,
        ctx,
        policy.pipelineId,
        policy.toStageId,
      );
      this.validateContract(policy.requiredFields, policy.conditionContract);
      if (
        policy.allowedActors.length === 0 ||
        policy.reasonCodes.length === 0
      ) {
        throw new BadRequestException(
          'A published transition requires actors and reason codes.',
        );
      }
      if (
        this.isTerminal(toStage) &&
        policy.allowedActors.some((actor) => actor !== 'human')
      ) {
        throw new BadRequestException({
          code: 'CRM_AUTOMATIC_TERMINAL_TRANSITION_FORBIDDEN',
          message:
            'The first automation version only allows humans to publish terminal transitions.',
        });
      }
      const repository = manager.getRepository(CrmStageTransitionPolicyEntity);
      const current = await repository.findOne({
        where: {
          tenantId: policy.tenantId,
          workspaceId: policy.workspaceId,
          pipelineId: policy.pipelineId,
          fromStageId: policy.fromStageId,
          toStageId: policy.toStageId,
          status: 'published',
          deletedAt: IsNull(),
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (current) {
        current.status = 'inactive';
        current.supersededByPolicyId = policy.id;
        await repository.save(current);
      }
      policy.status = 'published';
      policy.publishedAt = new Date();
      policy.publishedById = ctx.userId ?? null;
      return repository.save(policy);
    });
  }

  async deactivate(
    ctx: RequestContext,
    id: string,
  ): Promise<CrmStageTransitionPolicyEntity> {
    return this.dataSource.transaction(async (manager) => {
      const policy = await this.policy(manager, ctx, id, true);
      if (policy.status !== 'published') {
        throw new ConflictException(
          'Only a published transition can be deactivated.',
        );
      }
      policy.status = 'inactive';
      return manager.getRepository(CrmStageTransitionPolicyEntity).save(policy);
    });
  }

  async deleteDraft(
    ctx: RequestContext,
    id: string,
  ): Promise<{ deleted: true }> {
    return this.dataSource.transaction(async (manager) => {
      const policy = await this.policy(manager, ctx, id, true);
      this.assertDraft(policy);
      policy.deletedAt = new Date();
      await manager.getRepository(CrmStageTransitionPolicyEntity).save(policy);
      return { deleted: true };
    });
  }

  async assertTransitionAllowedWithinTransaction(
    manager: EntityManager,
    ctx: RequestContext,
    opportunity: CrmOpportunityEntity,
    targetStage: CrmStageEntity,
    actor: CrmCommandActor | undefined,
    reasonCode: string | null | undefined,
  ): Promise<CrmStageTransitionPolicyEntity> {
    if (opportunity.status !== 'open') {
      this.block(
        'terminal_opportunity',
        'Terminal opportunities cannot be reopened or moved.',
      );
    }
    const effectiveActor = this.policyActor(actor);
    if (
      effectiveActor !== 'human' &&
      targetStage.operationMode === 'human_managed'
    ) {
      this.block(
        'human_managed_destination',
        'This stage only accepts human-managed transitions.',
      );
    }
    if (effectiveActor !== 'human' && this.isTerminal(targetStage)) {
      this.block(
        'automatic_terminal_transition',
        'Automatic terminal transitions are disabled.',
      );
    }
    if (!reasonCode) {
      this.block(
        'reason_code_required',
        'A governed transition reason code is required.',
      );
    }
    const policy = await manager
      .getRepository(CrmStageTransitionPolicyEntity)
      .findOne({
        where: {
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          pipelineId: opportunity.pipelineId,
          fromStageId: opportunity.stageId,
          toStageId: targetStage.id,
          status: 'published',
          deletedAt: IsNull(),
        },
      });
    if (!policy)
      this.block(
        'transition_policy_missing',
        'No published policy allows this transition.',
      );
    if (!policy.allowedActors.includes(effectiveActor)) {
      this.block(
        'actor_not_allowed',
        'The command actor is not allowed by the published policy.',
      );
    }
    if (!policy.reasonCodes.includes(reasonCode)) {
      this.block(
        'reason_code_not_allowed',
        'The reason code is not allowed by the published policy.',
      );
    }
    const missingFields = policy.requiredFields.filter(
      (field) => !this.isPresent(this.readField(opportunity, field)),
    );
    if (missingFields.length > 0) {
      throw new ConflictException({
        code: 'CRM_STAGE_TRANSITION_BLOCKED',
        reasonCode: 'required_fields_missing',
        message: 'Required opportunity fields are missing.',
        missingFields,
        policyId: policy.id,
        policyVersion: policy.version,
      });
    }
    const failedConditions = (policy.conditionContract.all ?? []).filter(
      (condition) => !this.matches(opportunity, condition),
    );
    if (failedConditions.length > 0) {
      throw new ConflictException({
        code: 'CRM_STAGE_TRANSITION_BLOCKED',
        reasonCode: 'conditions_not_met',
        message:
          'The opportunity does not satisfy the published transition conditions.',
        failedFields: failedConditions.map((condition) => condition.field),
        policyId: policy.id,
        policyVersion: policy.version,
      });
    }
    return policy;
  }

  private async policy(
    manager: EntityManager,
    ctx: RequestContext,
    id: string,
    lock = false,
  ) {
    const policy = await manager
      .getRepository(CrmStageTransitionPolicyEntity)
      .findOne({
        where: {
          id,
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          deletedAt: IsNull(),
          ...this.clientScope(ctx),
        },
        lock: lock ? { mode: 'pessimistic_write' } : undefined,
      });
    if (!policy)
      throw new NotFoundException('CRM stage transition policy not found.');
    return policy;
  }

  private async stage(
    manager: EntityManager,
    ctx: RequestContext,
    pipelineId: string,
    id: string,
  ) {
    const stage = await manager.getRepository(CrmStageEntity).findOne({
      where: {
        id,
        pipelineId,
        tenantId: this.tenantId(ctx),
        workspaceId: this.workspaceId(ctx),
        deletedAt: IsNull(),
        ...this.clientScope(ctx),
      },
    });
    if (!stage)
      throw new NotFoundException(
        'CRM stage not found in the selected pipeline.',
      );
    return stage;
  }

  private async lockEdge(
    manager: EntityManager,
    ctx: RequestContext,
    pipelineId: string,
    fromStageId: string,
    toStageId: string,
  ) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [
        `crm-transition:${this.tenantId(ctx)}:${this.workspaceId(ctx)}:${pipelineId}:${fromStageId}:${toStageId}`,
      ],
    );
  }

  private validateContract(
    requiredFields: string[],
    contract: CrmStageTransitionConditionContract,
  ): void {
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
      throw new BadRequestException('Condition contract must be an object.');
    }
    for (const field of requiredFields) this.assertField(field);
    if (contract.all !== undefined && !Array.isArray(contract.all)) {
      throw new BadRequestException('Condition contract all must be an array.');
    }
    for (const condition of contract.all ?? []) {
      this.assertField(condition.field);
      if (
        !['present', 'equals', 'not_equals', 'in'].includes(condition.operator)
      ) {
        throw new BadRequestException(
          `Unsupported condition operator: ${condition.operator}.`,
        );
      }
      if (condition.operator === 'in' && !Array.isArray(condition.value)) {
        throw new BadRequestException(
          `Condition ${condition.field} requires an array value.`,
        );
      }
    }
  }

  private assertField(field: string): void {
    if (
      !CANONICAL_FIELDS.has(field) &&
      !/^businessContext\.[A-Za-z0-9_-]{1,80}$/.test(field)
    ) {
      throw new BadRequestException(`Unsupported transition field: ${field}.`);
    }
  }

  private matches(
    opportunity: CrmOpportunityEntity,
    condition: CrmStageTransitionCondition,
  ): boolean {
    const actual = this.readField(opportunity, condition.field);
    if (condition.operator === 'present') return this.isPresent(actual);
    if (condition.operator === 'equals') return actual === condition.value;
    if (condition.operator === 'not_equals') return actual !== condition.value;
    return Array.isArray(condition.value) && condition.value.includes(actual);
  }

  private conditionSummary(condition: CrmStageTransitionCondition): string {
    if (condition.operator === 'present') return `${condition.field}:present`;
    const value = JSON.stringify(condition.value);
    return `${condition.field}:${condition.operator}:${value.slice(0, 180)}`;
  }

  private readField(opportunity: CrmOpportunityEntity, field: string): unknown {
    if (field.startsWith('businessContext.')) {
      return opportunity.businessContext?.[
        field.slice('businessContext.'.length)
      ];
    }
    return (opportunity as unknown as Record<string, unknown>)[field];
  }

  private isPresent(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  private policyActor(actor?: CrmCommandActor): CrmStageTransitionActor {
    if (!actor || actor.type === 'user') return 'human';
    return actor.type;
  }

  private isTerminal(stage: CrmStageEntity): boolean {
    return (
      stage.type === 'won' ||
      stage.type === 'lost' ||
      stage.isWonStage ||
      stage.isLostStage
    );
  }

  private assertDraft(policy: CrmStageTransitionPolicyEntity): void {
    if (policy.status !== 'draft') {
      throw new ConflictException(
        'Published and inactive transition versions are immutable.',
      );
    }
  }

  private unique<T extends string>(values: T[]): T[] {
    return [
      ...new Set(values.map((value) => value.trim()).filter(Boolean) as T[]),
    ];
  }

  private block(reasonCode: string, message: string): never {
    throw new ConflictException({
      code: 'CRM_STAGE_TRANSITION_BLOCKED',
      reasonCode,
      message,
    });
  }

  private tenantId(ctx: RequestContext): string {
    if (!ctx.tenantId)
      throw new BadRequestException('Tenant context is required.');
    return ctx.tenantId;
  }

  private workspaceId(ctx: RequestContext): string {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    return ctx.workspaceId;
  }

  private clientScope(ctx: RequestContext) {
    const clientId = ctx.managedContext?.clientId;
    if (!clientId) return {};
    return {
      metadata: Raw(
        (alias) => `${alias} ->> 'clientId' = :transitionClientId`,
        {
          transitionClientId: clientId,
        },
      ),
    };
  }
}
