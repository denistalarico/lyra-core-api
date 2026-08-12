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
  isAddressableOpportunityField,
  isLeadScoreField,
} from '../catalog/crm-opportunity-field.catalog';
import {
  CreateCrmStageTransitionPolicyDto,
  PatchCrmStageTransitionPolicyDto,
} from '../dto/crm-stage-transition-policy.dto';
import { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';
import { CrmStageEntity } from '../entities/crm-stage.entity';
import { buildDefaultTransitionPlan } from './crm-stage-transition-defaults';
import { CrmLeadScoreStateEntity } from '../lead-score/entities/crm-lead-score-state.entity';
import {
  CrmStageTransitionActor,
  CrmStageTransitionCondition,
  CrmStageTransitionConditionContract,
  CrmStageTransitionPolicyEntity,
} from '../entities/crm-stage-transition-policy.entity';
import type { CrmCommandActor } from './crm-opportunity-command.service';

/**
 * The Lead Score of the opportunity under evaluation, or `null` when it was
 * never scored. Loaded from the score's own table only when a policy references
 * it. `null` is not zero: a policy that gates on the score refuses to advance an
 * unscored lead rather than treating "we could not tell" as "the answer is no".
 */
type LeadScoreProjection = { score: number; band: string } | null;

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

/**
 * A destination an automation may drive an opportunity to, for configuration.
 *
 * Sourced from the published transition policies that admit the `automation`
 * actor — never invented. An operator configuring the governed stage-advance
 * recipe picks from these, so the value they save is one the runtime can
 * actually carry out, rather than a free-typed stage id that the executor would
 * later refuse.
 */
export type CrmAutomationTransitionDestination = {
  fromStageId: string;
  fromStageName: string;
  toStageId: string;
  toStageName: string;
  reasonCodes: string[];
  requiredFields: string[];
};

export type CrmEligibleAutomationTransition = {
  toStageId: string;
  reasonCode: string;
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

  /**
   * Publishes the pipeline's default movement plan, skipping edges that already
   * have a policy.
   *
   * Governance here is fail-closed, so a pipeline without policies is a board
   * where nothing can move. Rather than asking an operator to author 26 edges
   * before the first drag, the structurally legal ones start published and
   * governance becomes something they narrow.
   *
   * An edge is skipped when *any* row exists for it, deleted rows included: a
   * transition someone deactivated or deleted was a decision, and healing must
   * never silently reopen it. `onlyWhenUnconfigured` is the healing path for
   * pipelines created before this existed — it acts only on a pipeline that has
   * never had a single policy, which is unambiguous, and never on one that is
   * partially configured.
   */
  async ensureDefaultPolicies(
    ctx: RequestContext,
    pipelineId: string,
    options: { onlyWhenUnconfigured?: boolean } = {},
  ): Promise<{ created: number }> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockPipeline(manager, ctx, pipelineId);
      const repository = manager.getRepository(CrmStageTransitionPolicyEntity);
      const existing = await repository.find({
        where: {
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          pipelineId,
          ...this.clientScope(ctx),
        },
        withDeleted: true,
      });
      if (options.onlyWhenUnconfigured && existing.length > 0) {
        return { created: 0 };
      }

      const stages = await manager.getRepository(CrmStageEntity).find({
        where: {
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          pipelineId,
          deletedAt: IsNull(),
          ...this.clientScope(ctx),
        },
      });
      const configured = new Set(
        existing.map((policy) => `${policy.fromStageId}>${policy.toStageId}`),
      );
      const missing = buildDefaultTransitionPlan(stages).filter(
        (edge) => !configured.has(`${edge.fromStageId}>${edge.toStageId}`),
      );
      if (missing.length === 0) return { created: 0 };

      const publishedAt = new Date();
      await repository.save(
        missing.map((edge) =>
          repository.create({
            tenantId: this.tenantId(ctx),
            workspaceId: this.workspaceId(ctx),
            pipelineId,
            fromStageId: edge.fromStageId,
            toStageId: edge.toStageId,
            allowedActors: edge.allowedActors,
            requiredFields: [],
            conditionContract: {},
            reasonCodes: edge.reasonCodes,
            aiGuidance: null,
            status: 'published',
            version: 1,
            publishedAt,
            publishedById: ctx.userId ?? null,
            createdById: ctx.userId ?? null,
            supersededByPolicyId: null,
            metadata: {
              systemGenerated: true,
              ...(ctx.managedContext?.clientId
                ? { clientId: ctx.managedContext.clientId }
                : {}),
            },
          }),
        ),
      );
      return { created: missing.length };
    });
  }

  /**
   * Destinations an automation may target in a pipeline.
   *
   * Only edges a published policy admits for the `automation` actor, and only
   * to non-terminal, non-human-managed stages — the exact set the runtime will
   * accept. A terminal or human-only stage is filtered here so it can never be
   * offered, mirroring the executor's own refusals but at configuration time.
   */
  async getAutomationDestinations(
    ctx: RequestContext,
    pipelineId: string,
  ): Promise<CrmAutomationTransitionDestination[]> {
    const policies = await this.dataSource
      .getRepository(CrmStageTransitionPolicyEntity)
      .find({
        where: {
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          pipelineId,
          status: 'published',
          deletedAt: IsNull(),
          ...this.clientScope(ctx),
        },
        order: { fromStageId: 'ASC', toStageId: 'ASC', version: 'DESC' },
      });

    const automationPolicies = policies.filter((policy) =>
      policy.allowedActors.includes('automation'),
    );
    if (automationPolicies.length === 0) return [];

    const stageIds = [
      ...new Set(
        automationPolicies.flatMap((policy) => [
          policy.fromStageId,
          policy.toStageId,
        ]),
      ),
    ];
    const stages = await this.dataSource.getRepository(CrmStageEntity).find({
      where: stageIds.map((id) => ({
        id,
        tenantId: this.tenantId(ctx),
        workspaceId: this.workspaceId(ctx),
        pipelineId,
        deletedAt: IsNull(),
      })),
    });
    const stageById = new Map(stages.map((stage) => [stage.id, stage]));

    // Only the newest published policy per edge is offered; the ASC/DESC order
    // above puts it first, so the first seen for an edge wins.
    const seenEdges = new Set<string>();
    const destinations: CrmAutomationTransitionDestination[] = [];
    for (const policy of automationPolicies) {
      const edge = `${policy.fromStageId}:${policy.toStageId}`;
      if (seenEdges.has(edge)) continue;
      seenEdges.add(edge);

      const fromStage = stageById.get(policy.fromStageId);
      const toStage = stageById.get(policy.toStageId);
      if (
        !fromStage ||
        !toStage ||
        toStage.operationMode === 'human_managed' ||
        this.isTerminal(toStage)
      ) {
        continue;
      }

      destinations.push({
        fromStageId: fromStage.id,
        fromStageName: fromStage.name,
        toStageId: toStage.id,
        toStageName: toStage.name,
        reasonCodes: policy.reasonCodes,
        requiredFields: policy.requiredFields,
      });
    }
    return destinations;
  }

  /**
   * Whether the CRM settings contain at least one real automatic movement rule.
   *
   * System-generated, unrestricted movement policies keep manual board drag
   * working, but must never turn the automation on by themselves. A rule only
   * counts as configured when it admits the automation actor and declares
   * fields or conditions that the backend can validate.
   */
  async hasConfiguredAutomationRules(
    ctx: RequestContext,
    pipelineId: string,
  ): Promise<boolean> {
    const policies = await this.dataSource
      .getRepository(CrmStageTransitionPolicyEntity)
      .find({
        where: {
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          pipelineId,
          status: 'published',
          deletedAt: IsNull(),
          ...this.clientScope(ctx),
        },
      });

    return policies.some((policy) => this.isConfiguredAutomationRule(policy));
  }

  /**
   * Resolves the first eligible destination for the opportunity's current
   * stage. The executor calls this when the automation is CRM-managed instead
   * of carrying a duplicated destination in its own JSON configuration.
   */
  async resolveEligibleAutomationDestination(
    ctx: RequestContext,
    opportunityId: string,
  ): Promise<CrmEligibleAutomationTransition | null> {
    const opportunity = await this.dataSource
      .getRepository(CrmOpportunityEntity)
      .findOne({
        where: {
          id: opportunityId,
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          deletedAt: IsNull(),
        },
      });
    if (
      !opportunity ||
      opportunity.status !== 'open' ||
      opportunity.autonomyMode !== 'automatic'
    ) {
      return null;
    }

    const policies = await this.dataSource
      .getRepository(CrmStageTransitionPolicyEntity)
      .find({
        where: {
          tenantId: opportunity.tenantId,
          workspaceId: opportunity.workspaceId,
          pipelineId: opportunity.pipelineId,
          fromStageId: opportunity.stageId,
          status: 'published',
          deletedAt: IsNull(),
        },
        order: { version: 'DESC' },
      });
    const configured = policies.filter((policy) =>
      this.isConfiguredAutomationRule(policy),
    );
    if (configured.length === 0) return null;

    const targetIds = [
      ...new Set(configured.map((policy) => policy.toStageId)),
    ];
    const targets = await this.dataSource.getRepository(CrmStageEntity).find({
      where: targetIds.map((id) => ({
        id,
        tenantId: opportunity.tenantId,
        workspaceId: opportunity.workspaceId,
        pipelineId: opportunity.pipelineId,
        deletedAt: IsNull(),
      })),
      order: { sortOrder: 'ASC' },
    });
    const targetById = new Map(targets.map((stage) => [stage.id, stage]));
    const leadScore = configured.some((policy) =>
      this.contractReferencesLeadScore(
        policy.requiredFields,
        policy.conditionContract,
      ),
    )
      ? await this.loadLeadScore(
          this.dataSource,
          {
            tenantId: opportunity.tenantId,
            workspaceId: opportunity.workspaceId,
          },
          opportunity.id,
        )
      : null;

    const eligible = configured
      .map((policy) => ({ policy, target: targetById.get(policy.toStageId) }))
      .filter(
        (
          item,
        ): item is {
          policy: CrmStageTransitionPolicyEntity;
          target: CrmStageEntity;
        } =>
          Boolean(item.target) &&
          item.target?.operationMode !== 'human_managed' &&
          !this.isTerminal(item.target as CrmStageEntity),
      )
      .sort((left, right) => left.target.sortOrder - right.target.sortOrder)
      .find(({ policy }) => {
        const fieldsPresent = policy.requiredFields.every((field) =>
          this.isPresent(this.readField(opportunity, field, leadScore)),
        );
        const conditionsMet = (policy.conditionContract.all ?? []).every(
          (condition) => this.matches(opportunity, condition, leadScore),
        );
        return fieldsPresent && conditionsMet;
      });

    if (!eligible) return null;
    return {
      toStageId: eligible.target.id,
      reasonCode: eligible.policy.reasonCodes.includes(
        'automatic_stage_advance',
      )
        ? 'automatic_stage_advance'
        : eligible.policy.reasonCodes[0],
    };
  }

  /**
   * Fails closed on a governed stage-advance configuration.
   *
   * Refuses to save a destination and reason that no published automation
   * policy admits. The executor would refuse the same combination at run time;
   * catching it here means an operator cannot store a configuration that is
   * guaranteed to do nothing.
   */
  async assertAutomationDestination(
    ctx: RequestContext,
    input: { toStageId: string; reasonCode: string },
  ): Promise<void> {
    const destinations = await this.dataSource
      .getRepository(CrmStageTransitionPolicyEntity)
      .find({
        where: {
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          toStageId: input.toStageId,
          status: 'published',
          deletedAt: IsNull(),
          ...this.clientScope(ctx),
        },
      });

    const admitting = destinations.filter(
      (policy) =>
        policy.allowedActors.includes('automation') &&
        policy.reasonCodes.includes(input.reasonCode),
    );
    if (admitting.length === 0) {
      throw new BadRequestException({
        code: 'AUTOMATION_TRANSITION_NOT_ALLOWED',
        message:
          'A etapa de destino e o motivo escolhidos não correspondem a nenhuma transição governada publicada que permita automações.',
      });
    }

    const toStage = await this.dataSource
      .getRepository(CrmStageEntity)
      .findOne({
        where: {
          id: input.toStageId,
          tenantId: this.tenantId(ctx),
          workspaceId: this.workspaceId(ctx),
          deletedAt: IsNull(),
        },
      });
    if (!toStage || this.isTerminal(toStage)) {
      throw new BadRequestException({
        code: 'AUTOMATION_TRANSITION_TERMINAL',
        message:
          'Automações não podem avançar para uma etapa de ganho ou perda.',
      });
    }
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
    // One read per opportunity, and only when some destination gates on the
    // score — the catalog must not query a table no policy here consults.
    const leadScore = aiPolicies.some((policy) =>
      this.contractReferencesLeadScore(
        policy.requiredFields,
        policy.conditionContract,
      ),
    )
      ? await this.loadLeadScore(
          this.dataSource,
          {
            tenantId: opportunity.tenantId,
            workspaceId: opportunity.workspaceId,
          },
          opportunity.id,
        )
      : null;
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
        this.isPresent(this.readField(opportunity, field, leadScore)),
      );
      const missingFields = policy.requiredFields.filter(
        (field) => !presentFields.includes(field),
      );
      const failedConditions = (policy.conditionContract.all ?? []).filter(
        (condition) => !this.matches(opportunity, condition, leadScore),
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
      this.assertConfigurableEdge(fromStage, toStage);
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
      const [fromStage, toStage] = await Promise.all([
        this.stage(manager, ctx, policy.pipelineId, policy.fromStageId),
        this.stage(manager, ctx, policy.pipelineId, policy.toStageId),
      ]);
      this.assertConfigurableEdge(fromStage, toStage);
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
    const leadScore = this.contractReferencesLeadScore(
      policy.requiredFields,
      policy.conditionContract,
    )
      ? await this.loadLeadScore(
          manager,
          { tenantId: this.tenantId(ctx), workspaceId: this.workspaceId(ctx) },
          opportunity.id,
        )
      : null;
    const missingFields = policy.requiredFields.filter(
      (field) => !this.isPresent(this.readField(opportunity, field, leadScore)),
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
      (condition) => !this.matches(opportunity, condition, leadScore),
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

  /**
   * Serializes work that spans every edge of a pipeline. `lockEdge` is per pair,
   * so two concurrent seedings would each see an empty plan and race into the
   * unique index on the published pair.
   */
  private async lockPipeline(
    manager: EntityManager,
    ctx: RequestContext,
    pipelineId: string,
  ) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [
        `crm-transition-pipeline:${this.tenantId(ctx)}:${this.workspaceId(ctx)}:${pipelineId}`,
      ],
    );
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
        !['present', 'equals', 'not_equals', 'in', 'gte', 'lte'].includes(
          condition.operator,
        )
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
      if (
        (condition.operator === 'gte' || condition.operator === 'lte') &&
        (typeof condition.value !== 'number' ||
          !Number.isFinite(condition.value))
      ) {
        throw new BadRequestException(
          `Condition ${condition.field} requires a numeric value.`,
        );
      }
    }
  }

  private assertField(field: string): void {
    // Structural, not catalog-scoped: a published policy must not become
    // invalid because the client later switched Business Mode. The catalog
    // decides what to offer an operator; this decides what is addressable.
    if (!isAddressableOpportunityField(field)) {
      throw new BadRequestException(`Unsupported transition field: ${field}.`);
    }
  }

  private matches(
    opportunity: CrmOpportunityEntity,
    condition: CrmStageTransitionCondition,
    leadScore: LeadScoreProjection,
  ): boolean {
    const actual = this.readField(opportunity, condition.field, leadScore);
    if (condition.operator === 'present') return this.isPresent(actual);
    if (condition.operator === 'equals') return actual === condition.value;
    if (condition.operator === 'not_equals') return actual !== condition.value;
    if (condition.operator === 'gte') {
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual >= condition.value
      );
    }
    if (condition.operator === 'lte') {
      return (
        typeof actual === 'number' &&
        typeof condition.value === 'number' &&
        actual <= condition.value
      );
    }
    return Array.isArray(condition.value) && condition.value.includes(actual);
  }

  private conditionSummary(condition: CrmStageTransitionCondition): string {
    if (condition.operator === 'present') return `${condition.field}:present`;
    if (condition.operator === 'gte') {
      return `${condition.field}:>=${JSON.stringify(condition.value)}`;
    }
    if (condition.operator === 'lte') {
      return `${condition.field}:<=${JSON.stringify(condition.value)}`;
    }
    const value = JSON.stringify(condition.value);
    return `${condition.field}:${condition.operator}:${value.slice(0, 180)}`;
  }

  private readField(
    opportunity: CrmOpportunityEntity,
    field: string,
    leadScore: LeadScoreProjection,
  ): unknown {
    // The score is not on the opportunity by design; read it from the
    // projection loaded for this evaluation. Absent when unscored, which every
    // operator treats as "no value" rather than a silent zero.
    if (field === 'leadScore.band') return leadScore?.band ?? undefined;
    if (field === 'leadScore.score') return leadScore?.score ?? undefined;
    if (field.startsWith('businessContext.')) {
      return opportunity.businessContext?.[
        field.slice('businessContext.'.length)
      ];
    }
    return (opportunity as unknown as Record<string, unknown>)[field];
  }

  /** Whether a policy reads the Lead Score, so it is loaded only when needed. */
  private contractReferencesLeadScore(
    requiredFields: string[],
    contract: CrmStageTransitionConditionContract,
  ): boolean {
    if (requiredFields.some((field) => isLeadScoreField(field))) return true;
    return (contract.all ?? []).some((condition) =>
      isLeadScoreField(condition.field),
    );
  }

  private isConfiguredAutomationRule(
    policy: CrmStageTransitionPolicyEntity,
  ): boolean {
    return (
      policy.allowedActors.includes('automation') &&
      (policy.requiredFields.length > 0 ||
        (policy.conditionContract.all?.length ?? 0) > 0)
    );
  }

  /**
   * Reads the opportunity's current score from its own table.
   *
   * `reader` is the caller's transaction manager in enforcement and the data
   * source in the read-only catalog — both expose the same repository, so the
   * evaluation stays inside whatever transaction the caller already opened.
   */
  private async loadLeadScore(
    reader: DataSource | EntityManager,
    scope: { tenantId: string; workspaceId: string },
    opportunityId: string,
  ): Promise<LeadScoreProjection> {
    const state = await reader.getRepository(CrmLeadScoreStateEntity).findOne({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        opportunityId,
      },
    });
    return state ? { score: state.score, band: state.band } : null;
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

  /**
   * The UI can guide an operator, but this is the authority that prevents a
   * direct API caller from defining an impossible lifecycle edge. Entry stages
   * are chosen when an opportunity is created; terminal stages end its path.
   */
  private assertConfigurableEdge(
    fromStage: CrmStageEntity,
    toStage: CrmStageEntity,
  ): void {
    if (this.isTerminal(fromStage)) {
      throw new BadRequestException({
        code: 'CRM_STAGE_TRANSITION_TERMINAL_SOURCE',
        message: 'Won and lost stages cannot have outgoing transitions.',
      });
    }
    if (toStage.isInitialStage || toStage.role === 'entry') {
      throw new BadRequestException({
        code: 'CRM_STAGE_TRANSITION_INITIAL_DESTINATION',
        message:
          'The entry stage is selected when creating an opportunity and cannot be a transition destination.',
      });
    }
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
