import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Raw } from 'typeorm';
import { RequestContext } from '../../../common/context/request-context.interface';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { CrmOpportunityEventEntity } from '../entities/crm-opportunity-event.entity';
import { CrmOpportunityEntity } from '../entities/crm-opportunity.entity';
import { CrmPipelineEntity } from '../entities/crm-pipeline.entity';
import { CrmStageEntity } from '../entities/crm-stage.entity';
import { CrmStageTransitionPolicyService } from './crm-stage-transition-policy.service';
import { LeadScoreEngineService } from '../lead-score/services/lead-score-engine.service';
import type { LeadScoreCalculationReason } from '../lead-score/lead-score.types';

export type CrmCommandActor = {
  type: 'user' | 'ai' | 'automation' | 'system';
  userId?: string | null;
  agentId?: string | null;
};

export type CrmCommandOptions = {
  actor?: CrmCommandActor;
  expectedVersion?: number;
  expectedTransitionPolicyId?: string;
  expectedTransitionPolicyVersion?: number;
  transferMode?: 'manual' | 'handoff' | 'automation';
  idempotencyKey?: string;
  correlationId?: string;
  causationId?: string | null;
  policyVersion?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type CrmHistoryInput = CrmCommandOptions & {
  opportunity: CrmOpportunityEntity;
  eventType: string;
  title: string;
  description?: string | null;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  confidence?: number | string | null;
};

export type CrmCopyOpportunityInput = {
  pipelineId: string;
  stageId: string;
  title?: string;
};

export type CrmReconvertOpportunityInput = {
  pipelineId: string;
  title?: string;
};

const MUTABLE_FIELDS: Array<keyof CrmOpportunityEntity> = [
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
  'businessContext',
  'assignedUserId',
  'expectedCloseDate',
  'nextFollowUpAt',
  'lastActivityAt',
  'lostReason',
  'cardColor',
  'sortOrder',
  'visibility',
  'followMode',
  'followMessage',
  'followSendAutomatically',
  'metadata',
  'deletedAt',
];

@Injectable()
export class CrmOpportunityCommandService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly transitionPolicies: CrmStageTransitionPolicyService,
    private readonly leadScore: LeadScoreEngineService,
  ) {}

  async createOpportunity(
    ctx: RequestContext,
    opportunity: CrmOpportunityEntity,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    const saved = await this.createOpportunityInTransaction(
      ctx,
      opportunity,
      options,
    );
    await this.scoreAfterCommand(ctx, saved.id, 'opportunity_created');
    return saved;
  }

  private async createOpportunityInTransaction(
    ctx: RequestContext,
    opportunity: CrmOpportunityEntity,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    return this.dataSource.transaction(async (manager) => {
      const replay = await this.findReplay(
        manager,
        ctx,
        options.idempotencyKey,
      );
      if (replay) return replay;

      const conversation = await this.assertConversationAvailableForCreation(
        manager,
        ctx,
        opportunity,
      );

      opportunity.rowVersion = 1;
      const saved = await manager
        .getRepository(CrmOpportunityEntity)
        .save(opportunity);
      await this.appendHistory(manager, ctx, {
        ...options,
        opportunity: saved,
        eventType: 'opportunity_created',
        title: 'Oportunidade criada',
        afterData: this.projection(saved),
      });
      if (conversation) {
        await manager.getRepository(InboxConversationEntity).update(
          {
            id: conversation.id,
            tenantId: conversation.tenantId,
            workspaceId: conversation.workspaceId,
          },
          { opportunityId: saved.id },
        );
      }
      return saved;
    });
  }

  async recordEvent(
    ctx: RequestContext,
    opportunityId: string,
    input: Omit<CrmHistoryInput, 'opportunity'>,
  ): Promise<CrmOpportunityEventEntity> {
    return this.dataSource.transaction(async (manager) => {
      const opportunity = await this.findScopedOpportunity(
        manager,
        ctx,
        opportunityId,
        false,
      );
      return this.appendHistory(manager, ctx, { ...input, opportunity });
    });
  }

  async updateOpportunity(
    ctx: RequestContext,
    candidate: CrmOpportunityEntity,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    const saved = await this.updateOpportunityInTransaction(
      ctx,
      candidate,
      options,
    );
    await this.scoreAfterCommand(ctx, saved.id, 'opportunity_updated');
    return saved;
  }

  private async updateOpportunityInTransaction(
    ctx: RequestContext,
    candidate: CrmOpportunityEntity,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    return this.dataSource.transaction(async (manager) => {
      const replay = await this.findReplay(
        manager,
        ctx,
        options.idempotencyKey,
      );
      if (replay) return replay;

      const locked = await this.findScopedOpportunity(
        manager,
        ctx,
        candidate.id,
        true,
      );
      this.assertVersion(locked, options.expectedVersion);
      const before = this.projection(locked);
      this.assertImmutableIdentity(locked, candidate);
      for (const field of MUTABLE_FIELDS) {
        (locked[field] as unknown) = candidate[field];
      }
      locked.rowVersion += 1;
      const saved = await manager
        .getRepository(CrmOpportunityEntity)
        .save(locked);
      await this.appendHistory(manager, ctx, {
        ...options,
        opportunity: saved,
        eventType: 'opportunity_updated',
        title: 'Oportunidade atualizada',
        beforeData: before,
        afterData: this.projection(saved),
      });
      return saved;
    });
  }

  async moveStage(
    ctx: RequestContext,
    opportunityId: string,
    stageId: string,
    options: CrmCommandOptions & {
      sortOrder?: number;
      beforeOpportunityId?: string | null;
    } = {},
  ): Promise<{
    opportunity: CrmOpportunityEntity;
    event: CrmOpportunityEventEntity | null;
  }> {
    const result = await this.dataSource.transaction((manager) =>
      this.moveStageWithinTransaction(
        manager,
        ctx,
        opportunityId,
        stageId,
        options,
      ),
    );
    await this.scoreAfterCommand(ctx, opportunityId, 'stage_changed');
    return result;
  }

  async transferPipeline(
    ctx: RequestContext,
    opportunityId: string,
    pipelineId: string,
    stageId: string,
    options: CrmCommandOptions = {},
  ): Promise<{
    opportunity: CrmOpportunityEntity;
    event: CrmOpportunityEventEntity | null;
  }> {
    return this.dataSource.transaction((manager) =>
      this.transferPipelineWithinTransaction(
        manager,
        ctx,
        opportunityId,
        pipelineId,
        stageId,
        options,
      ),
    );
  }

  async copyOpportunity(
    ctx: RequestContext,
    sourceOpportunityId: string,
    input: CrmCopyOpportunityInput,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    return this.dataSource.transaction((manager) =>
      this.copyOpportunityWithinTransaction(
        manager,
        ctx,
        sourceOpportunityId,
        input,
        options,
      ),
    );
  }

  async copyOpportunityWithinTransaction(
    manager: EntityManager,
    ctx: RequestContext,
    sourceOpportunityId: string,
    input: CrmCopyOpportunityInput,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    const replay = await this.findReplay(manager, ctx, options.idempotencyKey);
    if (replay) return replay;

    const source = await this.findScopedOpportunity(
      manager,
      ctx,
      sourceOpportunityId,
      true,
    );
    this.assertVersion(source, options.expectedVersion);
    this.assertCopyReason(options.reason);
    if (!source.contactId) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_COPY_BLOCKED',
        reasonCode: 'source_contact_missing',
        message: 'A related negotiation requires a canonical contact.',
      });
    }

    const [pipeline, stage] = await Promise.all([
      this.findScopedPipeline(manager, ctx, input.pipelineId),
      this.findScopedStage(manager, ctx, input.stageId),
    ]);
    this.assertDerivedTarget(source, pipeline, stage, false);

    const correlationId = options.correlationId ?? randomUUID();
    const opportunity = manager.getRepository(CrmOpportunityEntity).create({
      tenantId: source.tenantId,
      workspaceId: source.workspaceId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      contactId: source.contactId,
      contactName: source.contactName,
      contactEmail: source.contactEmail,
      contactPhone: source.contactPhone,
      inboxConversationId: null,
      sourceOpportunityId: source.id,
      title: this.derivedTitle(input.title, source.title),
      description: source.description,
      valueAmount: source.valueAmount,
      currency: source.currency,
      status: 'open',
      priority: source.priority,
      source: source.source,
      businessMode: source.businessMode,
      operationalStatus: null,
      businessContext: {
        origin: 'crm_related_negotiation',
        opportunityResolution: {
          outcome: 'copied',
          sourceOpportunityId: source.id,
        },
      },
      assignedUserId: null,
      expectedCloseDate: null,
      nextFollowUpAt: null,
      lastActivityAt: null,
      wonAt: null,
      lostAt: null,
      lostReason: null,
      cardColor: null,
      sortOrder: await this.nextSortOrder(manager, ctx, pipeline.id, stage.id),
      visibility: 'workspace',
      followMode: 'manual',
      followMessage: null,
      followSendAutomatically: false,
      metadata: this.derivedMetadata(source, 'copy', options.reason),
      rowVersion: 1,
      deletedAt: null,
    });
    const saved = await manager
      .getRepository(CrmOpportunityEntity)
      .save(opportunity);
    const governedOptions: CrmCommandOptions = {
      ...options,
      correlationId,
      policyVersion: 'crm-opportunity-copy-policy-v1',
      metadata: {
        ...(options.metadata ?? {}),
        sourceOpportunityId: source.id,
        primaryConversationOpportunityId: source.inboxConversationId
          ? source.id
          : null,
        copiedFields: [
          'contact',
          'title',
          'description',
          'valueAmount',
          'currency',
          'priority',
          'source',
          'businessMode',
        ],
        excludedRelations: [
          'conversation',
          'messages',
          'activities',
          'attachments',
          'tags',
        ],
      },
    };
    await this.appendHistory(manager, ctx, {
      ...governedOptions,
      opportunity: saved,
      eventType: 'opportunity_created',
      title: 'Negociação relacionada criada',
      afterData: this.projection(saved),
      idempotencyKey: options.idempotencyKey
        ? `${options.idempotencyKey}:created`.slice(0, 180)
        : undefined,
    });
    await this.appendHistory(manager, ctx, {
      ...governedOptions,
      opportunity: saved,
      eventType: 'opportunity_copied',
      title: 'Oportunidade copiada para negociação relacionada',
      beforeData: this.projection(source),
      afterData: this.projection(saved),
    });
    return saved;
  }

  async reconvertOpportunity(
    ctx: RequestContext,
    sourceOpportunityId: string,
    input: CrmReconvertOpportunityInput,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    return this.dataSource.transaction(async (manager) => {
      const source = await this.findScopedOpportunity(
        manager,
        ctx,
        sourceOpportunityId,
        false,
      );
      const initialStage = await this.uniqueInitialStage(
        manager,
        ctx,
        input.pipelineId,
      );
      const candidate = manager.getRepository(CrmOpportunityEntity).create({
        tenantId: source.tenantId,
        workspaceId: source.workspaceId,
        pipelineId: input.pipelineId,
        stageId: initialStage.id,
        contactId: source.contactId,
        contactName: source.contactName,
        contactEmail: source.contactEmail,
        contactPhone: source.contactPhone,
        inboxConversationId: source.inboxConversationId,
        title: this.derivedTitle(input.title, source.title),
        description: null,
        valueAmount: null,
        currency: source.currency,
        priority: source.priority,
        source: source.source,
        businessMode: source.businessMode,
        operationalStatus: null,
        businessContext: {
          origin: 'crm_reconversion',
          opportunityResolution: {
            outcome: 'reconverted',
            sourceOpportunityId: source.id,
          },
        },
        assignedUserId: null,
        visibility: 'workspace',
        metadata: this.derivedMetadata(source, 'reconversion', options.reason),
      });
      return this.reconvertOpportunityWithinTransaction(
        manager,
        ctx,
        sourceOpportunityId,
        candidate,
        options,
      );
    });
  }

  async reconvertOpportunityWithinTransaction(
    manager: EntityManager,
    ctx: RequestContext,
    sourceOpportunityId: string,
    candidate: CrmOpportunityEntity,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    const replay = await this.findReplay(manager, ctx, options.idempotencyKey);
    if (replay) return replay;

    const sourceSnapshot = await this.findScopedOpportunity(
      manager,
      ctx,
      sourceOpportunityId,
      false,
    );
    if (sourceSnapshot.inboxConversationId) {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [
          `${sourceSnapshot.tenantId}:${sourceSnapshot.workspaceId}:${sourceSnapshot.inboxConversationId}:opportunity`,
        ],
      );
    }
    const source = await this.findScopedOpportunity(
      manager,
      ctx,
      sourceOpportunityId,
      true,
    );
    this.assertVersion(source, options.expectedVersion);
    this.assertReconversionReason(options.reason);
    if (source.status === 'open') {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_RECONVERSION_BLOCKED',
        reasonCode: 'source_not_terminal',
        message: 'Reconversion requires a terminal source opportunity.',
      });
    }
    if (!source.contactId || candidate.contactId !== source.contactId) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_RECONVERSION_BLOCKED',
        reasonCode: 'contact_mismatch',
        message: 'Reconversion must reuse the canonical contact.',
      });
    }
    if (candidate.inboxConversationId !== source.inboxConversationId) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_RECONVERSION_BLOCKED',
        reasonCode: 'conversation_mismatch',
        message: 'Reconversion cannot attach a different conversation.',
      });
    }

    const [pipeline, stage] = await Promise.all([
      this.findScopedPipeline(manager, ctx, candidate.pipelineId),
      this.findScopedStage(manager, ctx, candidate.stageId),
    ]);
    this.assertDerivedTarget(source, pipeline, stage, true);
    await this.assertConversationAvailableForReconversion(manager, ctx, source);

    const correlationId = options.correlationId ?? randomUUID();
    const opportunity = manager.getRepository(CrmOpportunityEntity).create({
      tenantId: source.tenantId,
      workspaceId: source.workspaceId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      contactId: source.contactId,
      contactName: candidate.contactName ?? source.contactName,
      contactEmail: candidate.contactEmail ?? source.contactEmail,
      contactPhone: candidate.contactPhone ?? source.contactPhone,
      inboxConversationId: source.inboxConversationId,
      sourceOpportunityId: source.id,
      title: this.derivedTitle(candidate.title, source.title),
      description: candidate.description ?? null,
      valueAmount: candidate.valueAmount ?? null,
      currency: candidate.currency || source.currency,
      status: 'open',
      priority: candidate.priority || source.priority,
      source: candidate.source || source.source,
      businessMode: source.businessMode,
      operationalStatus: candidate.operationalStatus ?? null,
      businessContext: candidate.businessContext ?? {},
      assignedUserId: candidate.assignedUserId ?? null,
      expectedCloseDate: null,
      nextFollowUpAt: null,
      lastActivityAt: null,
      wonAt: null,
      lostAt: null,
      lostReason: null,
      cardColor: null,
      sortOrder: await this.nextSortOrder(manager, ctx, pipeline.id, stage.id),
      visibility: candidate.visibility || 'workspace',
      followMode: 'manual',
      followMessage: null,
      followSendAutomatically: false,
      metadata: {
        ...candidate.metadata,
        ...this.derivedMetadata(source, 'reconversion', options.reason),
      },
      rowVersion: 1,
      deletedAt: null,
    });
    const saved = await manager
      .getRepository(CrmOpportunityEntity)
      .save(opportunity);
    if (source.inboxConversationId) {
      await manager.getRepository(InboxConversationEntity).update(
        {
          id: source.inboxConversationId,
          tenantId: source.tenantId,
          workspaceId: source.workspaceId,
        },
        { opportunityId: saved.id },
      );
    }
    const governedOptions: CrmCommandOptions = {
      ...options,
      correlationId,
      policyVersion: 'crm-opportunity-reconversion-policy-v1',
      metadata: {
        ...(options.metadata ?? {}),
        sourceOpportunityId: source.id,
        conversationId: saved.inboxConversationId,
        contactId: saved.contactId,
      },
    };
    await this.appendHistory(manager, ctx, {
      ...governedOptions,
      opportunity: saved,
      eventType: 'opportunity_created',
      title: 'Nova oportunidade criada por reconversão',
      afterData: this.projection(saved),
      idempotencyKey: options.idempotencyKey
        ? `${options.idempotencyKey}:created`.slice(0, 180)
        : undefined,
    });
    await this.appendHistory(manager, ctx, {
      ...governedOptions,
      opportunity: saved,
      eventType: 'opportunity_reconverted',
      title: 'Contato reconvertido em novo ciclo comercial',
      beforeData: this.projection(source),
      afterData: this.projection(saved),
    });
    return saved;
  }

  async transferPipelineWithinTransaction(
    manager: EntityManager,
    ctx: RequestContext,
    opportunityId: string,
    pipelineId: string,
    stageId: string,
    options: CrmCommandOptions = {},
  ): Promise<{
    opportunity: CrmOpportunityEntity;
    event: CrmOpportunityEventEntity | null;
  }> {
    const replay = await this.findReplay(manager, ctx, options.idempotencyKey);
    if (replay) return { opportunity: replay, event: null };

    const opportunity = await this.findScopedOpportunity(
      manager,
      ctx,
      opportunityId,
      true,
    );
    this.assertVersion(opportunity, options.expectedVersion);
    if (opportunity.status !== 'open') {
      throw new ConflictException({
        code: 'CRM_PIPELINE_TRANSFER_BLOCKED',
        reasonCode: 'terminal_opportunity',
        message: 'Terminal opportunities cannot be transferred.',
      });
    }
    if (opportunity.pipelineId === pipelineId) {
      throw new BadRequestException({
        code: 'CRM_PIPELINE_TRANSFER_BLOCKED',
        reasonCode: 'same_pipeline',
        message: 'Use the stage command inside the current pipeline.',
      });
    }
    this.assertPipelineTransferReason(options);
    const [targetPipeline, targetStage] = await Promise.all([
      this.findScopedPipeline(manager, ctx, pipelineId),
      this.findScopedStage(manager, ctx, stageId),
    ]);
    if (targetPipeline.status !== 'active') {
      throw new ConflictException({
        code: 'CRM_PIPELINE_TRANSFER_BLOCKED',
        reasonCode: 'target_pipeline_inactive',
        message: 'The target pipeline is not active.',
      });
    }
    if (targetStage.pipelineId !== targetPipeline.id) {
      throw new BadRequestException({
        code: 'CRM_PIPELINE_TRANSFER_BLOCKED',
        reasonCode: 'target_stage_pipeline_mismatch',
        message: 'The target stage does not belong to the target pipeline.',
      });
    }
    if (this.statusForStage(targetStage) !== 'open') {
      throw new ConflictException({
        code: 'CRM_PIPELINE_TRANSFER_BLOCKED',
        reasonCode: 'target_stage_terminal',
        message: 'Pipeline transfer requires a non-terminal target stage.',
      });
    }
    if (targetPipeline.businessMode !== opportunity.businessMode) {
      throw new ConflictException({
        code: 'CRM_PIPELINE_TRANSFER_BLOCKED',
        reasonCode: 'business_mode_mismatch',
        message: 'The target pipeline must use the opportunity business mode.',
      });
    }
    if (
      options.transferMode === 'handoff' &&
      targetStage.operationMode === 'ai_managed'
    ) {
      throw new ConflictException({
        code: 'CRM_PIPELINE_TRANSFER_BLOCKED',
        reasonCode: 'handoff_target_not_human',
        message: 'Handoff transfer requires a human or hybrid target stage.',
      });
    }

    const beforeData = {
      pipelineId: opportunity.pipelineId,
      stageId: opportunity.stageId,
      status: opportunity.status,
      sortOrder: opportunity.sortOrder,
    };
    opportunity.pipelineId = targetPipeline.id;
    opportunity.stageId = targetStage.id;
    opportunity.status = 'open';
    opportunity.sortOrder = await this.nextSortOrder(
      manager,
      ctx,
      targetPipeline.id,
      targetStage.id,
    );
    opportunity.rowVersion += 1;
    opportunity.wonAt = null;
    opportunity.lostAt = null;
    opportunity.lostReason = null;
    const saved = await manager
      .getRepository(CrmOpportunityEntity)
      .save(opportunity);
    const governedOptions: CrmCommandOptions = {
      ...options,
      policyVersion: 'crm-pipeline-transfer-policy-v1',
      metadata: {
        ...(options.metadata ?? {}),
        transferMode: options.transferMode ?? 'manual',
        sourcePipelineId: beforeData.pipelineId,
        sourceStageId: beforeData.stageId,
        targetPipelineId: saved.pipelineId,
        targetStageId: saved.stageId,
      },
    };
    await this.appendHistory(manager, ctx, {
      ...governedOptions,
      opportunity: saved,
      eventType: 'pipeline_exited',
      title: 'Oportunidade saiu do pipeline',
      beforeData,
      afterData: this.projection(saved),
    });
    await this.appendHistory(manager, ctx, {
      ...governedOptions,
      opportunity: saved,
      eventType: 'stage_exited',
      title: 'Oportunidade saiu da etapa',
      beforeData,
      afterData: this.projection(saved),
    });
    const event = await this.appendHistory(manager, ctx, {
      ...governedOptions,
      opportunity: saved,
      eventType: 'pipeline_transferred',
      title: 'Oportunidade transferida entre pipelines',
      beforeData,
      afterData: this.projection(saved),
    });
    await this.appendHistory(manager, ctx, {
      ...governedOptions,
      opportunity: saved,
      eventType: 'pipeline_entered',
      title: 'Oportunidade entrou no pipeline',
      beforeData,
      afterData: this.projection(saved),
    });
    await this.appendHistory(manager, ctx, {
      ...governedOptions,
      opportunity: saved,
      eventType: 'stage_entered',
      title: 'Oportunidade entrou na etapa',
      beforeData,
      afterData: this.projection(saved),
    });
    return { opportunity: saved, event };
  }

  async moveStageWithinTransaction(
    manager: EntityManager,
    ctx: RequestContext,
    opportunityId: string,
    stageId: string,
    options: CrmCommandOptions & {
      sortOrder?: number;
      beforeOpportunityId?: string | null;
    } = {},
  ): Promise<{
    opportunity: CrmOpportunityEntity;
    event: CrmOpportunityEventEntity | null;
  }> {
    const replay = await this.findReplay(manager, ctx, options.idempotencyKey);
    if (replay) return { opportunity: replay, event: null };

    const opportunity = await this.findScopedOpportunity(
      manager,
      ctx,
      opportunityId,
      true,
    );
    this.assertVersion(opportunity, options.expectedVersion);
    const stage = await this.findScopedStage(manager, ctx, stageId);
    if (stage.pipelineId !== opportunity.pipelineId) {
      throw new BadRequestException(
        'Stage does not belong to this opportunity pipeline.',
      );
    }

    const previousStageId = opportunity.stageId;
    const previousStatus = opportunity.status;
    const previousSortOrder = opportunity.sortOrder;
    const nextStatus = this.statusForStage(stage);
    const stageChanged = previousStageId !== stage.id;
    const statusChanged = previousStatus !== nextStatus;
    if (
      !stageChanged &&
      !statusChanged &&
      options.sortOrder === undefined &&
      options.beforeOpportunityId === undefined
    ) {
      return { opportunity, event: null };
    }

    let governedOptions = options;
    if (stageChanged) {
      const policy =
        await this.transitionPolicies.assertTransitionAllowedWithinTransaction(
          manager,
          ctx,
          opportunity,
          stage,
          options.actor,
          options.reason,
        );
      if (
        (options.expectedTransitionPolicyId &&
          policy.id !== options.expectedTransitionPolicyId) ||
        (options.expectedTransitionPolicyVersion !== undefined &&
          policy.version !== options.expectedTransitionPolicyVersion)
      ) {
        throw new ConflictException({
          code: 'CRM_STAGE_TRANSITION_BLOCKED',
          reasonCode: 'transition_policy_stale',
          message:
            'The published transition policy no longer matches the proposed version.',
        });
      }
      governedOptions = {
        ...options,
        policyVersion: `${policy.id}:v${policy.version}`,
        metadata: {
          ...(options.metadata ?? {}),
          transitionPolicyId: policy.id,
          transitionPolicyVersion: policy.version,
        },
      };
    }

    opportunity.stageId = stage.id;
    opportunity.status = nextStatus;
    opportunity.sortOrder =
      options.sortOrder ??
      (await this.resolveMoveSortOrder(
        manager,
        ctx,
        opportunity,
        stage.id,
        options.beforeOpportunityId,
      ));
    this.applyTerminalTimestamps(opportunity, nextStatus, previousStatus);
    opportunity.rowVersion += 1;
    const saved = await manager
      .getRepository(CrmOpportunityEntity)
      .save(opportunity);

    let event: CrmOpportunityEventEntity | null = null;
    if (stageChanged) {
      event = await this.appendHistory(manager, ctx, {
        ...governedOptions,
        opportunity: saved,
        eventType: 'stage_changed',
        title: 'Etapa alterada',
        beforeData: { stageId: previousStageId, status: previousStatus },
        afterData: { stageId: saved.stageId, status: saved.status },
      });
    }
    if (statusChanged) {
      await this.appendStatusEvents(
        manager,
        ctx,
        saved,
        previousStatus,
        governedOptions,
      );
    }
    if (!stageChanged && !statusChanged) {
      event = await this.appendHistory(manager, ctx, {
        ...governedOptions,
        opportunity: saved,
        eventType: 'opportunity_updated',
        title: 'Ordem da oportunidade alterada',
        beforeData: { sortOrder: previousSortOrder },
        afterData: { sortOrder: saved.sortOrder },
      });
    }
    return { opportunity: saved, event };
  }

  async changeStatus(
    ctx: RequestContext,
    opportunityId: string,
    status: string,
    lostReason: string | null | undefined,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    const saved = await this.dataSource.transaction((manager) =>
      this.changeStatusWithinTransaction(
        manager,
        ctx,
        opportunityId,
        status,
        lostReason,
        options,
      ),
    );
    await this.scoreAfterCommand(ctx, opportunityId, 'lifecycle_changed');
    return saved;
  }

  async changeStatusWithinTransaction(
    manager: EntityManager,
    ctx: RequestContext,
    opportunityId: string,
    status: string,
    lostReason: string | null | undefined,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    const replay = await this.findReplay(manager, ctx, options.idempotencyKey);
    if (replay) return replay;

    const opportunity = await this.findScopedOpportunity(
      manager,
      ctx,
      opportunityId,
      true,
    );
    this.assertVersion(opportunity, options.expectedVersion);
    const previousStatus = opportunity.status;
    const previousStageId = opportunity.stageId;
    if (previousStatus !== 'open' && status !== previousStatus) {
      throw new ConflictException({
        code: 'CRM_STAGE_TRANSITION_BLOCKED',
        reasonCode: 'terminal_opportunity',
        message: 'Terminal opportunities cannot be reopened or changed.',
      });
    }
    let targetStage: CrmStageEntity | null = null;
    if (status === 'won' || status === 'lost') {
      targetStage = await this.uniqueLifecycleStage(
        manager,
        ctx,
        opportunity.pipelineId,
        status,
      );
    }

    let governedOptions = options;
    if (targetStage && targetStage.id !== opportunity.stageId) {
      const policy =
        await this.transitionPolicies.assertTransitionAllowedWithinTransaction(
          manager,
          ctx,
          opportunity,
          targetStage,
          options.actor,
          options.reason,
        );
      governedOptions = {
        ...options,
        policyVersion: `${policy.id}:v${policy.version}`,
        metadata: {
          ...(options.metadata ?? {}),
          transitionPolicyId: policy.id,
          transitionPolicyVersion: policy.version,
        },
      };
    }

    opportunity.status = status;
    if (targetStage) {
      opportunity.stageId = targetStage.id;
      opportunity.sortOrder = await this.nextSortOrder(
        manager,
        ctx,
        opportunity.pipelineId,
        targetStage.id,
      );
    }
    if (lostReason !== undefined) opportunity.lostReason = lostReason;
    this.applyTerminalTimestamps(opportunity, status, previousStatus);
    opportunity.rowVersion += 1;
    const saved = await manager
      .getRepository(CrmOpportunityEntity)
      .save(opportunity);

    if (previousStageId !== saved.stageId) {
      await this.appendHistory(manager, ctx, {
        ...governedOptions,
        opportunity: saved,
        eventType: 'stage_changed',
        title: 'Etapa alterada',
        beforeData: { stageId: previousStageId, status: previousStatus },
        afterData: { stageId: saved.stageId, status: saved.status },
      });
    }
    if (previousStatus !== saved.status) {
      await this.appendStatusEvents(
        manager,
        ctx,
        saved,
        previousStatus,
        governedOptions,
      );
    }
    return saved;
  }

  async updateWithinTransaction(
    manager: EntityManager,
    ctx: RequestContext,
    candidate: CrmOpportunityEntity,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity> {
    const replay = await this.findReplay(manager, ctx, options.idempotencyKey);
    if (replay) return replay;
    const locked = await this.findScopedOpportunity(
      manager,
      ctx,
      candidate.id,
      true,
    );
    this.assertVersion(locked, options.expectedVersion);
    const before = this.projection(locked);
    this.assertImmutableIdentity(locked, candidate);
    for (const field of MUTABLE_FIELDS) {
      (locked[field] as unknown) = candidate[field];
    }
    locked.rowVersion += 1;
    const saved = await manager
      .getRepository(CrmOpportunityEntity)
      .save(locked);
    await this.appendHistory(manager, ctx, {
      ...options,
      opportunity: saved,
      eventType: 'opportunity_updated',
      title: 'Oportunidade atualizada',
      beforeData: before,
      afterData: this.projection(saved),
    });
    return saved;
  }

  async reorder(
    ctx: RequestContext,
    items: Array<{
      id: string;
      stageId: string;
      sortOrder: number;
      expectedVersion?: number;
      reasonCode: string;
    }>,
    options: CrmCommandOptions = {},
  ): Promise<CrmOpportunityEntity[]> {
    return this.dataSource.transaction(async (manager) => {
      const results: CrmOpportunityEntity[] = [];
      for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
        const moved = await this.moveStageWithinTransaction(
          manager,
          ctx,
          item.id,
          item.stageId,
          {
            ...options,
            expectedVersion: item.expectedVersion,
            sortOrder: item.sortOrder,
            reason: item.reasonCode,
            idempotencyKey: options.idempotencyKey
              ? `${options.idempotencyKey}:${item.id}`.slice(0, 180)
              : undefined,
          },
        );
        results.push(moved.opportunity);
      }
      return results;
    });
  }

  async appendHistory(
    manager: EntityManager,
    ctx: RequestContext,
    input: CrmHistoryInput,
  ): Promise<CrmOpportunityEventEntity> {
    const tenantId = this.requireTenantId(ctx);
    const workspaceId = this.requireWorkspaceId(ctx);
    if (
      input.opportunity.tenantId !== tenantId ||
      input.opportunity.workspaceId !== workspaceId
    ) {
      throw new BadRequestException(
        'Opportunity scope does not match command scope.',
      );
    }
    if (input.idempotencyKey && input.idempotencyKey.length > 180) {
      throw new BadRequestException(
        'Idempotency key must contain at most 180 characters.',
      );
    }

    const correlationId = input.correlationId ?? randomUUID();
    const actor = input.actor ?? {
      type: 'user' as const,
      userId: ctx.userId ?? null,
    };
    const event = manager.getRepository(CrmOpportunityEventEntity).create({
      tenantId,
      workspaceId,
      opportunityId: input.opportunity.id,
      actorType: actor.type,
      actorUserId: actor.userId ?? null,
      actorAgentId: actor.agentId ?? null,
      eventType: input.eventType,
      title: input.title,
      description: input.description ?? null,
      beforeData: input.beforeData ?? {},
      afterData: input.afterData ?? {},
      reason: input.reason ?? null,
      confidence:
        input.confidence === undefined || input.confidence === null
          ? null
          : String(input.confidence),
      metadata: input.metadata ?? {},
      eventVersion: 1,
      idempotencyKey: input.idempotencyKey ?? null,
      correlationId,
      causationId: input.causationId ?? null,
      policyVersion: input.policyVersion ?? null,
    });
    const saved = await manager
      .getRepository(CrmOpportunityEventEntity)
      .save(event);
    const eventName = this.domainEventName(input.eventType);
    const outboxKey = this.outboxKey(saved, input.idempotencyKey);
    await manager.getRepository(InboxDomainOutboxEntity).save(
      manager.getRepository(InboxDomainOutboxEntity).create({
        tenantId,
        workspaceId,
        aggregateType: 'crm_opportunity',
        aggregateId: input.opportunity.id,
        eventName,
        eventVersion: 1,
        idempotencyKey: outboxKey,
        payload: {
          eventId: saved.id,
          opportunityId: input.opportunity.id,
          contactId: input.opportunity.contactId,
          conversationId: input.opportunity.inboxConversationId,
          sourceOpportunityId: input.opportunity.sourceOpportunityId,
          pipelineId: input.opportunity.pipelineId,
          stageId: input.opportunity.stageId,
          eventType: input.eventType,
          reasonCode: input.reason ?? null,
          correlationId,
          causationId: input.causationId ?? null,
          rowVersion: input.opportunity.rowVersion,
        },
        status: 'pending',
        deliveryKind: 'realtime',
        attempts: 0,
        availableAt: new Date(),
        publishedAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        deadLetteredAt: null,
        skippedAt: null,
        skipReason: null,
        retainUntil: null,
      }),
    );
    return saved;
  }

  private async appendStatusEvents(
    manager: EntityManager,
    ctx: RequestContext,
    opportunity: CrmOpportunityEntity,
    previousStatus: string,
    options: CrmCommandOptions,
  ): Promise<void> {
    await this.appendHistory(manager, ctx, {
      ...options,
      opportunity,
      eventType: 'status_changed',
      title: 'Status alterado',
      beforeData: { status: previousStatus },
      afterData: {
        status: opportunity.status,
        pipelineId: opportunity.pipelineId,
        stageId: opportunity.stageId,
        valueAmount: opportunity.valueAmount,
        currency: opportunity.currency,
      },
    });
    if (opportunity.status === 'won' || opportunity.status === 'lost') {
      await this.appendHistory(manager, ctx, {
        ...options,
        opportunity,
        eventType: `opportunity_${opportunity.status}`,
        title:
          opportunity.status === 'won'
            ? 'Oportunidade ganha'
            : 'Oportunidade perdida',
        beforeData: { status: previousStatus },
        afterData: {
          status: opportunity.status,
          pipelineId: opportunity.pipelineId,
          stageId: opportunity.stageId,
          valueAmount: opportunity.valueAmount,
          currency: opportunity.currency,
        },
      });
    }
  }

  private async findReplay(
    manager: EntityManager,
    ctx: RequestContext,
    idempotencyKey?: string,
  ): Promise<CrmOpportunityEntity | null> {
    if (!idempotencyKey) return null;
    const event = await manager
      .getRepository(CrmOpportunityEventEntity)
      .findOne({
        where: {
          tenantId: this.requireTenantId(ctx),
          workspaceId: this.requireWorkspaceId(ctx),
          idempotencyKey,
        },
        order: { createdAt: 'ASC' },
      });
    if (!event) return null;
    return this.findScopedOpportunity(manager, ctx, event.opportunityId, false);
  }

  private async findScopedOpportunity(
    manager: EntityManager,
    ctx: RequestContext,
    id: string,
    lock: boolean,
  ): Promise<CrmOpportunityEntity> {
    const opportunity = await manager
      .getRepository(CrmOpportunityEntity)
      .findOne({
        where: this.withClientScope(ctx, {
          id,
          tenantId: this.requireTenantId(ctx),
          workspaceId: this.requireWorkspaceId(ctx),
          deletedAt: IsNull(),
        }),
        ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      });
    if (!opportunity) throw new NotFoundException('CRM opportunity not found.');
    return opportunity;
  }

  private async findScopedStage(
    manager: EntityManager,
    ctx: RequestContext,
    id: string,
  ): Promise<CrmStageEntity> {
    const stage = await manager.getRepository(CrmStageEntity).findOne({
      where: this.withClientScope(ctx, {
        id,
        tenantId: this.requireTenantId(ctx),
        workspaceId: this.requireWorkspaceId(ctx),
        deletedAt: IsNull(),
      }),
    });
    if (!stage) throw new NotFoundException('CRM stage not found.');
    return stage;
  }

  private async findScopedPipeline(
    manager: EntityManager,
    ctx: RequestContext,
    id: string,
  ): Promise<CrmPipelineEntity> {
    const pipeline = await manager.getRepository(CrmPipelineEntity).findOne({
      where: this.withClientScope(ctx, {
        id,
        tenantId: this.requireTenantId(ctx),
        workspaceId: this.requireWorkspaceId(ctx),
        deletedAt: IsNull(),
      }),
      lock: { mode: 'pessimistic_read' },
    });
    if (!pipeline) throw new NotFoundException('CRM pipeline not found.');
    return pipeline;
  }

  private async uniqueLifecycleStage(
    manager: EntityManager,
    ctx: RequestContext,
    pipelineId: string,
    status: 'won' | 'lost',
  ): Promise<CrmStageEntity> {
    const flag = status === 'won' ? 'isWonStage' : 'isLostStage';
    const stages = await manager.getRepository(CrmStageEntity).find({
      where: [
        this.withClientScope(ctx, {
          tenantId: this.requireTenantId(ctx),
          workspaceId: this.requireWorkspaceId(ctx),
          pipelineId,
          type: status,
          deletedAt: IsNull(),
        }),
        this.withClientScope(ctx, {
          tenantId: this.requireTenantId(ctx),
          workspaceId: this.requireWorkspaceId(ctx),
          pipelineId,
          [flag]: true,
          deletedAt: IsNull(),
        }),
      ],
      take: 3,
    });
    const unique = [
      ...new Map(stages.map((stage) => [stage.id, stage])).values(),
    ];
    if (unique.length !== 1) {
      throw new ConflictException(
        `Pipeline must have exactly one ${status} stage; found ${unique.length}.`,
      );
    }
    return unique[0];
  }

  private async firstOpenStage(
    manager: EntityManager,
    ctx: RequestContext,
    pipelineId: string,
  ): Promise<CrmStageEntity> {
    const stages = await manager.getRepository(CrmStageEntity).find({
      where: this.withClientScope(ctx, {
        tenantId: this.requireTenantId(ctx),
        workspaceId: this.requireWorkspaceId(ctx),
        pipelineId,
        type: 'open',
        isWonStage: false,
        isLostStage: false,
        deletedAt: IsNull(),
      }),
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
      take: 1,
    });
    if (!stages[0]) {
      throw new ConflictException('Pipeline does not have an open stage.');
    }
    return stages[0];
  }

  private async nextSortOrder(
    manager: EntityManager,
    ctx: RequestContext,
    pipelineId: string,
    stageId: string,
  ): Promise<number> {
    const last = await manager.getRepository(CrmOpportunityEntity).findOne({
      where: this.withClientScope(ctx, {
        tenantId: this.requireTenantId(ctx),
        workspaceId: this.requireWorkspaceId(ctx),
        pipelineId,
        stageId,
        deletedAt: IsNull(),
      }),
      order: { sortOrder: 'DESC' },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  private async resolveMoveSortOrder(
    manager: EntityManager,
    ctx: RequestContext,
    opportunity: CrmOpportunityEntity,
    stageId: string,
    beforeOpportunityId?: string | null,
  ): Promise<number> {
    if (!beforeOpportunityId) {
      return this.nextSortOrder(manager, ctx, opportunity.pipelineId, stageId);
    }
    if (beforeOpportunityId === opportunity.id) return opportunity.sortOrder;

    const before = await this.findScopedOpportunity(
      manager,
      ctx,
      beforeOpportunityId,
      true,
    );
    if (
      before.pipelineId !== opportunity.pipelineId ||
      before.stageId !== stageId
    ) {
      throw new BadRequestException(
        'Order reference does not belong to the target stage.',
      );
    }

    const clientId = ctx.managedContext?.clientId ?? null;
    const targetSortOrder = before.sortOrder;
    await manager.query(
      `UPDATE crm_opportunities
          SET sort_order = sort_order + 1,
              row_version = row_version + 1,
              updated_at = now()
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND pipeline_id = $3
          AND stage_id = $4
          AND id <> $5
          AND sort_order >= $6
          AND deleted_at IS NULL
          AND ($7::text IS NULL OR metadata ->> 'clientId' = $7::text)`,
      [
        this.requireTenantId(ctx),
        this.requireWorkspaceId(ctx),
        opportunity.pipelineId,
        stageId,
        opportunity.id,
        targetSortOrder,
        clientId,
      ],
    );
    return targetSortOrder;
  }

  private statusForStage(stage: CrmStageEntity): string {
    if (stage.isWonStage || stage.type === 'won') return 'won';
    if (stage.isLostStage || stage.type === 'lost') return 'lost';
    return 'open';
  }

  private applyTerminalTimestamps(
    opportunity: CrmOpportunityEntity,
    status: string,
    previousStatus: string,
  ): void {
    if (status === 'won') {
      opportunity.wonAt ??= new Date();
      opportunity.lostAt = null;
      opportunity.lostReason = null;
    } else if (status === 'lost') {
      opportunity.lostAt ??= new Date();
      opportunity.wonAt = null;
    } else if (status === 'open' && previousStatus !== 'open') {
      opportunity.wonAt = null;
      opportunity.lostAt = null;
      opportunity.lostReason = null;
    }
  }

  private assertVersion(
    opportunity: CrmOpportunityEntity,
    expectedVersion?: number,
  ): void {
    if (
      expectedVersion !== undefined &&
      opportunity.rowVersion !== expectedVersion
    ) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_VERSION_CONFLICT',
        message: 'Opportunity was changed by another request.',
        expectedVersion,
        currentVersion: opportunity.rowVersion,
      });
    }
  }

  private assertImmutableIdentity(
    current: CrmOpportunityEntity,
    candidate: CrmOpportunityEntity,
  ): void {
    if (candidate.inboxConversationId !== current.inboxConversationId) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_IDENTITY_IMMUTABLE',
        reasonCode: 'conversation_link_immutable',
        message:
          'The primary conversation link is managed by governed commands.',
      });
    }
    if (
      current.sourceOpportunityId &&
      candidate.contactId !== current.contactId
    ) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_IDENTITY_IMMUTABLE',
        reasonCode: 'lineage_contact_immutable',
        message: 'A derived opportunity must preserve its canonical contact.',
      });
    }
  }

  private assertPipelineTransferReason(options: CrmCommandOptions): void {
    const mode = options.transferMode ?? 'manual';
    const allowed =
      mode === 'handoff'
        ? ['handoff_pipeline_transfer']
        : ['manual_pipeline_transfer', 'sales_process_reroute'];
    if (!options.reason || !allowed.includes(options.reason)) {
      throw new BadRequestException({
        code: 'CRM_PIPELINE_TRANSFER_BLOCKED',
        reasonCode: 'transfer_reason_not_allowed',
        message: 'The transfer reason is not allowed by the active policy.',
      });
    }
  }

  private assertCopyReason(reason?: string | null): void {
    if (
      !reason ||
      ![
        'distinct_negotiation',
        'parallel_sales_process',
        'commercial_expansion',
      ].includes(reason)
    ) {
      throw new BadRequestException({
        code: 'CRM_OPPORTUNITY_COPY_BLOCKED',
        reasonCode: 'copy_reason_not_allowed',
        message: 'The copy reason is not allowed by the active policy.',
      });
    }
  }

  private assertReconversionReason(reason?: string | null): void {
    if (
      !reason ||
      !['new_conversion', 'renewed_interest', 'new_sales_cycle'].includes(
        reason,
      )
    ) {
      throw new BadRequestException({
        code: 'CRM_OPPORTUNITY_RECONVERSION_BLOCKED',
        reasonCode: 'reconversion_reason_not_allowed',
        message: 'The reconversion reason is not allowed by the active policy.',
      });
    }
  }

  private assertDerivedTarget(
    source: CrmOpportunityEntity,
    pipeline: CrmPipelineEntity,
    stage: CrmStageEntity,
    requireInitialStage: boolean,
  ): void {
    const code = requireInitialStage
      ? 'CRM_OPPORTUNITY_RECONVERSION_BLOCKED'
      : 'CRM_OPPORTUNITY_COPY_BLOCKED';
    if (pipeline.status !== 'active') {
      throw new ConflictException({
        code,
        reasonCode: 'target_pipeline_inactive',
        message: 'The target pipeline is not active.',
      });
    }
    if (stage.pipelineId !== pipeline.id) {
      throw new BadRequestException({
        code,
        reasonCode: 'target_stage_pipeline_mismatch',
        message: 'The target stage does not belong to the target pipeline.',
      });
    }
    if (this.statusForStage(stage) !== 'open') {
      throw new ConflictException({
        code,
        reasonCode: 'target_stage_terminal',
        message: 'A derived opportunity requires a non-terminal target stage.',
      });
    }
    if (requireInitialStage && !stage.isInitialStage) {
      throw new ConflictException({
        code,
        reasonCode: 'target_stage_not_initial',
        message: 'Reconversion must start in the configured initial stage.',
      });
    }
    if (pipeline.businessMode !== source.businessMode) {
      throw new ConflictException({
        code,
        reasonCode: 'business_mode_mismatch',
        message: 'The target pipeline must use the source business mode.',
      });
    }
  }

  private async assertConversationAvailableForReconversion(
    manager: EntityManager,
    ctx: RequestContext,
    source: CrmOpportunityEntity,
  ): Promise<void> {
    if (!source.inboxConversationId) return;
    const conversation = await manager
      .getRepository(InboxConversationEntity)
      .findOne({
        where: {
          id: source.inboxConversationId,
          tenantId: this.requireTenantId(ctx),
          workspaceId: this.requireWorkspaceId(ctx),
        },
        lock: { mode: 'pessimistic_write' },
      });
    if (!conversation || conversation.contactId !== source.contactId) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_RECONVERSION_BLOCKED',
        reasonCode: 'conversation_contact_mismatch',
        message: 'The primary conversation no longer matches the contact.',
      });
    }
    if (
      conversation.opportunityId &&
      conversation.opportunityId !== source.id
    ) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_RECONVERSION_BLOCKED',
        reasonCode: 'source_not_primary',
        message:
          'Only the primary conversation opportunity can be reconverted.',
      });
    }
    const active = await manager.getRepository(CrmOpportunityEntity).findOne({
      where: {
        tenantId: source.tenantId,
        workspaceId: source.workspaceId,
        inboxConversationId: source.inboxConversationId,
        status: 'open',
        deletedAt: IsNull(),
      },
      lock: { mode: 'pessimistic_write' },
    });
    if (active) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_RECONVERSION_BLOCKED',
        reasonCode: 'active_opportunity_exists',
        message: 'The conversation already has an active opportunity.',
      });
    }
  }

  private async assertConversationAvailableForCreation(
    manager: EntityManager,
    ctx: RequestContext,
    opportunity: CrmOpportunityEntity,
  ): Promise<InboxConversationEntity | null> {
    if (!opportunity.inboxConversationId) return null;
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [
        `${opportunity.tenantId}:${opportunity.workspaceId}:${opportunity.inboxConversationId}:opportunity`,
      ],
    );
    const conversation = await manager
      .getRepository(InboxConversationEntity)
      .findOne({
        where: {
          id: opportunity.inboxConversationId,
          tenantId: this.requireTenantId(ctx),
          workspaceId: this.requireWorkspaceId(ctx),
        },
        lock: { mode: 'pessimistic_write' },
      });
    if (!conversation) {
      throw new NotFoundException('Inbox conversation not found.');
    }
    if (
      !conversation.contactId ||
      conversation.contactId !== opportunity.contactId
    ) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_CREATION_BLOCKED',
        reasonCode: 'conversation_contact_mismatch',
        message:
          'The opportunity must reuse the conversation canonical contact.',
      });
    }
    const previous = await manager.getRepository(CrmOpportunityEntity).findOne({
      where: {
        tenantId: opportunity.tenantId,
        workspaceId: opportunity.workspaceId,
        inboxConversationId: opportunity.inboxConversationId,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });
    if (previous) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_CREATION_BLOCKED',
        reasonCode:
          previous.status === 'open'
            ? 'active_opportunity_exists'
            : 'terminal_opportunity_requires_reconversion',
        message:
          previous.status === 'open'
            ? 'The conversation already has an active opportunity.'
            : 'Use the explicit reconversion command after a terminal cycle.',
      });
    }
    if (conversation.opportunityId) {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_CREATION_BLOCKED',
        reasonCode: 'conversation_primary_pointer_occupied',
        message: 'The conversation already points to another opportunity.',
      });
    }
    return conversation;
  }

  private async uniqueInitialStage(
    manager: EntityManager,
    ctx: RequestContext,
    pipelineId: string,
  ): Promise<CrmStageEntity> {
    const stages = await manager.getRepository(CrmStageEntity).find({
      where: this.withClientScope(ctx, {
        tenantId: this.requireTenantId(ctx),
        workspaceId: this.requireWorkspaceId(ctx),
        pipelineId,
        isInitialStage: true,
        deletedAt: IsNull(),
      }),
      take: 2,
    });
    if (stages.length !== 1 || this.statusForStage(stages[0]) !== 'open') {
      throw new ConflictException({
        code: 'CRM_OPPORTUNITY_RECONVERSION_BLOCKED',
        reasonCode: 'initial_stage_unresolved',
        message:
          'The target pipeline must have exactly one open initial stage.',
      });
    }
    return stages[0];
  }

  private derivedTitle(
    requested: string | undefined,
    fallback: string,
  ): string {
    const title = requested?.trim() || fallback.trim();
    if (!title) {
      throw new BadRequestException('Opportunity title is required.');
    }
    return title.slice(0, 180);
  }

  private derivedMetadata(
    source: CrmOpportunityEntity,
    creationKind: 'copy' | 'reconversion',
    reason?: string | null,
  ): Record<string, unknown> {
    const clientId =
      typeof source.metadata?.clientId === 'string'
        ? source.metadata.clientId
        : null;
    const operatingMode =
      source.metadata?.operatingMode === 'client' ? 'client' : 'agency';
    return {
      creationKind,
      sourceOpportunityId: source.id,
      creationReason: reason ?? null,
      operatingMode,
      clientId,
      sourceProvenance: 'crm_opportunity_lineage',
    };
  }

  private projection(
    opportunity: CrmOpportunityEntity,
  ): Record<string, unknown> {
    return {
      opportunityId: opportunity.id,
      contactId: opportunity.contactId,
      conversationId: opportunity.inboxConversationId,
      sourceOpportunityId: opportunity.sourceOpportunityId,
      pipelineId: opportunity.pipelineId,
      stageId: opportunity.stageId,
      status: opportunity.status,
      assignedUserId: opportunity.assignedUserId,
      sortOrder: opportunity.sortOrder,
      rowVersion: opportunity.rowVersion,
    };
  }

  private domainEventName(eventType: string): string {
    const names: Record<string, string> = {
      opportunity_created: 'leadflow.crm.opportunity.created',
      opportunity_copied: 'leadflow.crm.opportunity.copied',
      opportunity_reconverted: 'leadflow.crm.opportunity.reconverted',
      opportunity_updated: 'leadflow.crm.opportunity.updated',
      stage_changed: 'leadflow.crm.opportunity.stage.changed',
      status_changed: 'leadflow.crm.opportunity.status.changed',
      opportunity_won: 'leadflow.crm.opportunity.won',
      opportunity_lost: 'leadflow.crm.opportunity.lost',
      pipeline_exited: 'leadflow.crm.opportunity.pipeline.exited',
      stage_exited: 'leadflow.crm.opportunity.stage.exited',
      pipeline_transferred: 'leadflow.crm.opportunity.pipeline.transferred',
      pipeline_entered: 'leadflow.crm.opportunity.pipeline.entered',
      stage_entered: 'leadflow.crm.opportunity.stage.entered',
    };
    return names[eventType] ?? 'leadflow.crm.opportunity.updated';
  }

  /**
   * Rescores a deal after the command that changed it has committed.
   *
   * Deliberately outside the command's transaction. Scoring takes its own
   * advisory lock and reads other domains; nesting it would invite lock-order
   * deadlocks, and a scoring failure would roll back a legitimate stage change.
   * The trade is that the score trails the command by milliseconds — acceptable,
   * because nothing acts on the score yet, and the alternative risks losing real
   * CRM writes.
   */
  private async scoreAfterCommand(
    ctx: RequestContext,
    opportunityId: string,
    reason: LeadScoreCalculationReason,
  ): Promise<void> {
    await this.leadScore.recalculateQuietly(ctx, { opportunityId, reason });
  }

  private outboxKey(
    event: CrmOpportunityEventEntity,
    commandKey?: string,
  ): string {
    const source = commandKey
      ? `${commandKey}:${event.eventType}`
      : `event:${event.id}`;
    return `crm:${createHash('sha256').update(source).digest('hex')}`;
  }

  private withClientScope<T extends Record<string, unknown>>(
    ctx: RequestContext,
    where: T,
  ): T {
    const clientId = ctx.managedContext?.clientId ?? null;
    if (!clientId) return where;
    return {
      ...where,
      metadata: Raw((alias) => `${alias} ->> 'clientId' = :managedClientId`, {
        managedClientId: clientId,
      }),
    };
  }

  private requireTenantId(ctx: RequestContext): string {
    if (!ctx.tenantId)
      throw new BadRequestException('Tenant context is required.');
    return ctx.tenantId;
  }

  private requireWorkspaceId(ctx: RequestContext): string {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    return ctx.workspaceId;
  }
}
