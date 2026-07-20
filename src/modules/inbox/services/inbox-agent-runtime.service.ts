import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { DataSource, IsNull } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities/leadflow-agent.entity';
import { LeadFlowAgentChannelBindingEntity } from '../../leadflow-agents/entities/leadflow-agent-channel-binding.entity';
import { LeadFlowAgentVersionEntity } from '../../leadflow-agents/entities/leadflow-agent-version.entity';
import {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../../leadflow-agents/enums/room-operational.enums';
import { OperationsRoomStateService } from '../../leadflow-agents/services/operations-room-state.service';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities/leadflow-client-settings.entity';
import { LeadFlowBusinessModeTemplateEntity } from '../../leadflow-settings/entities/leadflow-business-mode-template.entity';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { InboxAgentDecisionEntity } from '../entities/inbox-agent-decision.entity';
import type { InboxAgentDecisionReviewOutcome } from '../entities/inbox-agent-decision.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../entities/inbox-conversation-event.entity';
import { InboxMediaAssetEntity } from '../entities/inbox-media-asset.entity';
import { InboxMediaDerivativeEntity } from '../entities/inbox-media-derivative.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { InboxProcessingBatchEntity } from '../entities/inbox-processing-batch.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import {
  AgentDecisionPromptBuilder,
  AgentDecisionV1Service,
  BusinessModeActionPlanner,
} from '../runtime/agent-decision-v1.service';
import { InboxProviderService } from '../runtime/inbox-provider.service';
import { InboxRuntimeConfigService } from '../runtime/inbox-runtime-config.service';
import {
  AgentDecisionV1,
  AgentDecisionResult,
  InboxProviderError,
} from '../runtime/inbox-runtime.contracts';

export type AgentDecisionProposal = AgentDecisionV1;

export function resolveDecisionReviewOutcome(
  actionPlan: Array<Record<string, unknown>>,
  approvalKind: 'analysis' | 'actions',
  actionKeys: string[],
): InboxAgentDecisionReviewOutcome {
  if (approvalKind === 'analysis') return 'analysis_approved';
  const allowedCount = actionPlan.filter(
    (item) => item.allowed === true,
  ).length;
  return actionKeys.length < allowedCount
    ? 'actions_partially_approved'
    : 'actions_applied';
}

export function sameReviewActionKeys(
  left: string[] | null | undefined,
  right: string[],
) {
  const normalizedLeft = [...new Set(left ?? [])].sort();
  const normalizedRight = [...new Set(right)].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((key, index) => key === normalizedRight[index])
  );
}

export function orderContextMessages(messages: InboxMessageEntity[]) {
  return [...messages].sort((left, right) => {
    const time = left.occurredAt.getTime() - right.occurredAt.getTime();
    if (time !== 0) return time;
    const leftSequence =
      left.providerSequence === null ? null : BigInt(left.providerSequence);
    const rightSequence =
      right.providerSequence === null ? null : BigInt(right.providerSequence);
    if (
      leftSequence !== null &&
      rightSequence !== null &&
      leftSequence !== rightSequence
    ) {
      return leftSequence < rightSequence ? -1 : 1;
    }
    if (leftSequence !== null && rightSequence === null) return -1;
    if (leftSequence === null && rightSequence !== null) return 1;
    return left.id.localeCompare(right.id);
  });
}

@Injectable()
export class InboxAgentRuntimeService {
  private readonly logger = new Logger(InboxAgentRuntimeService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly files: FilesService,
    private readonly provider: InboxProviderService,
    private readonly config: InboxRuntimeConfigService,
    private readonly promptBuilder: AgentDecisionPromptBuilder,
    private readonly schema: AgentDecisionV1Service,
    private readonly actionPlanner: BusinessModeActionPlanner,
    @Optional()
    private readonly operationsRoomState?: OperationsRoomStateService,
  ) {}

  async claimAndProcess(workerId: string) {
    const batchId = await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT id FROM inbox_processing_batches
         WHERE attempt_count < 3 AND (
           (status = 'pending' AND due_at <= now())
           OR (status = 'processing' AND claimed_at < now() - interval '2 minutes')
         )
         ORDER BY due_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
      )) as unknown as Array<{ id: string }>;
      if (!rows[0]) return null;
      await manager
        .getRepository(InboxProcessingBatchEntity)
        .update(rows[0].id, {
          status: 'processing',
          claimedAt: new Date(),
          claimedBy: workerId,
          attemptCount: () => 'attempt_count + 1',
        });
      return rows[0].id;
    });
    if (!batchId) return null;
    return this.processBatch(batchId);
  }

  async processBatch(batchId: string) {
    const batch = await this.dataSource
      .getRepository(InboxProcessingBatchEntity)
      .findOneBy({ id: batchId });
    if (!batch) throw new NotFoundException('Processing batch not found.');
    const conversation = await this.dataSource
      .getRepository(InboxConversationEntity)
      .findOneBy({
        id: batch.conversationId,
        tenantId: batch.tenantId,
        workspaceId: batch.workspaceId,
      });
    const channel = await this.dataSource
      .getRepository(InboxChannelEntity)
      .findOneBy({
        id: batch.channelId,
        tenantId: batch.tenantId,
        workspaceId: batch.workspaceId,
      });
    if (
      !conversation ||
      conversation.ownershipState !== 'ai_active' ||
      !conversation.aiEnabled ||
      !channel ||
      channel.status !== 'active' ||
      channel.connectionStatus !== 'connected' ||
      !channel.aiEnabled
    ) {
      await this.dataSource
        .getRepository(InboxProcessingBatchEntity)
        .update(batch.id, {
          status: 'cancelled',
          errorCode:
            channel && channel.connectionStatus === 'connected'
              ? 'ai_not_owner'
              : 'channel_unavailable',
          completedAt: new Date(),
        });
      return null;
    }
    const existingDecision = await this.dataSource
      .getRepository(InboxAgentDecisionEntity)
      .findOneBy({
        tenantId: batch.tenantId,
        workspaceId: batch.workspaceId,
        idempotencyKey: `batch:${batch.id}:decision:v1`,
      });
    if (existingDecision) return existingDecision;
    const messages = await this.dataSource
      .getRepository(InboxMessageEntity)
      .createQueryBuilder('message')
      .where(
        'message.tenant_id = :tenantId AND message.workspace_id = :workspaceId AND message.conversation_id = :conversationId',
        batch,
      )
      .orderBy('message.occurred_at', 'DESC')
      .addOrderBy('message.provider_sequence', 'DESC', 'NULLS FIRST')
      .addOrderBy('message.id', 'DESC')
      .take(50)
      .getMany();
    const orderedMessages = orderContextMessages(messages);
    const media = await this.dataSource
      .getRepository(InboxMediaAssetEntity)
      .find({
        where: {
          tenantId: batch.tenantId,
          workspaceId: batch.workspaceId,
          conversationId: batch.conversationId,
        },
      });
    const derivatives = media.length
      ? await this.dataSource
          .getRepository(InboxMediaDerivativeEntity)
          .createQueryBuilder('derivative')
          .where(
            'derivative.tenant_id = :tenantId AND derivative.workspace_id = :workspaceId',
            batch,
          )
          .andWhere('derivative.media_asset_id IN (:...ids)', {
            ids: media.map((item) => item.id),
          })
          .getMany()
      : [];
    const opportunity = await this.dataSource
      .getRepository(CrmOpportunityEntity)
      .findOne({
        where: conversation.opportunityId
          ? {
              id: conversation.opportunityId,
              tenantId: batch.tenantId,
              workspaceId: batch.workspaceId,
            }
          : {
              inboxConversationId: conversation.id,
              tenantId: batch.tenantId,
              workspaceId: batch.workspaceId,
            },
      });
    const agent = await this.resolveAgent(batch, conversation);
    const version = agent?.publishedVersionId
      ? await this.dataSource
          .getRepository(LeadFlowAgentVersionEntity)
          .findOneBy({ id: agent.publishedVersionId, tenantId: batch.tenantId })
      : null;
    if (!agent || !version) {
      await this.dataSource
        .getRepository(InboxProcessingBatchEntity)
        .update(batch.id, {
          status: 'cancelled',
          errorCode: 'agent_unavailable',
          completedAt: new Date(),
        });
      return null;
    }
    await this.publishOperationalStatus(
      batch,
      agent.id,
      RoomAgentOperationalStatus.HandlingConversation,
      'processing_started',
    );

    try {
      const settings = await this.dataSource
        .getRepository(LeadFlowClientSettingsEntity)
        .findOne({
          where: agent?.settingsId
            ? {
                id: agent.settingsId,
                tenantId: batch.tenantId,
                workspaceId: batch.workspaceId,
              }
            : {
                tenantId: batch.tenantId,
                workspaceId: batch.workspaceId,
                contextType: LeadFlowSettingsContextType.Agency,
                agencyClientId: IsNull(),
              },
        });
      const businessModeTemplate = settings?.businessModeTemplateId
        ? await this.dataSource
            .getRepository(LeadFlowBusinessModeTemplateEntity)
            .createQueryBuilder('template')
            .where('template.id = :id', { id: settings.businessModeTemplateId })
            .andWhere(
              '(template.tenant_id IS NULL OR template.tenant_id = :tenantId)',
              {
                tenantId: batch.tenantId,
              },
            )
            .getOne()
        : null;
      const messageProjection = orderedMessages.map((message) => ({
        id: message.id,
        evidenceRef: `message:${message.id}`,
        direction: message.direction,
        type: message.messageType,
        content: message.content.slice(0, 2_000),
        occurredAt: message.occurredAt.toISOString(),
        providerSequence: message.providerSequence,
      }));
      const transcriptionProjection: Array<Record<string, unknown>> =
        derivatives
          .filter(
            (item) =>
              item.kind === 'transcription' && item.status === 'available',
          )
          .map((item) => ({
            assetId: item.mediaAssetId,
            evidenceRef: `transcription:${item.mediaAssetId}`,
            kind: 'transcription',
            outcome: item.outcome,
            text: item.content?.slice(0, 4_000) ?? '',
            language: item.language,
          }));
      if (
        !this.provider.supportsMultimodal() &&
        this.config.visionFallbackEnabled
      ) {
        transcriptionProjection.push(
          ...(await this.loadVisionFallback(media, derivatives)),
        );
      }
      const images = this.provider.supportsMultimodal()
        ? await this.loadImages(media)
        : [];
      const prompt = this.promptBuilder.build({
        businessMode: conversation.businessMode,
        ownership: {
          state: conversation.ownershipState,
          version: conversation.ownershipVersion,
        },
        allowedActions: [
          'set_stage',
          'add_tag',
          'set_summary',
          'close',
          'handoff',
        ],
        workspaceConfig: {
          clientPromptConfig: settings?.clientPromptConfig ?? {},
          businessModeOverrides: settings?.businessModeOverrides ?? {},
        },
        contact: { id: conversation.contactId },
        opportunity: opportunity
          ? {
              id: opportunity.id,
              pipelineId: opportunity.pipelineId,
              stageId: opportunity.stageId,
              businessMode: opportunity.businessMode,
              status: opportunity.status,
              businessContext: opportunity.businessContext,
            }
          : null,
        messages: messageProjection,
        transcriptions: transcriptionProjection,
        images: images.map(({ assetId, evidenceRef, mimeType }) => ({
          assetId,
          evidenceRef,
          mimeType,
        })),
        businessModeInstruction: businessModeTemplate?.agentPromptTemplate ?? {
          key: conversation.businessMode,
        },
        businessModeVersion: businessModeTemplate?.version ?? 1,
        agentProfile:
          version?.snapshot && typeof version.snapshot === 'object'
            ? ((version.snapshot as Record<string, unknown>).agentIdentity ??
              {})
            : agent
              ? { name: agent.name, behavior: agent.behaviorConfig }
              : {},
        agentProfileVersion: version?.version ?? 0,
        companyContext: settings?.companyContextPublished ?? {},
        companyContextVersion: settings?.companyContextPublishedVersion ?? 0,
        companyContextHash: settings?.companyContextPublishedHash ?? null,
      });
      const correlationId = randomUUID();
      let providerResult: AgentDecisionResult | null = null;
      let proposal: AgentDecisionV1 | null = null;
      try {
        for (let repairAttempt = 0; repairAttempt < 2; repairAttempt += 1) {
          providerResult = await this.provider.decide({
            tenantId: batch.tenantId,
            workspaceId: batch.workspaceId,
            correlationId,
            idempotencyKey: `batch:${batch.id}:decision:v1${repairAttempt ? ':repair' : ''}`,
            agent: {
              id: agent?.id ?? null,
              versionId: version?.id ?? null,
              snapshot: version?.snapshot ?? {},
            },
            businessMode: conversation.businessMode,
            workspaceConfig: settings?.agentConfig ?? {},
            contact: { id: conversation.contactId },
            opportunity: opportunity
              ? {
                  id: opportunity.id,
                  pipelineId: opportunity.pipelineId,
                  stageId: opportunity.stageId,
                  status: opportunity.status,
                }
              : null,
            ownership: {
              state: conversation.ownershipState,
              version: conversation.ownershipVersion,
            },
            allowedActions: [
              'set_stage',
              'add_tag',
              'set_summary',
              'close',
              'handoff',
            ],
            systemPolicy: `${prompt.systemPolicy}${repairAttempt ? '\nREPAIR: a saída anterior violou o schema; devolva apenas JSON válido.' : ''}`,
            untrustedData: prompt.untrustedData,
            promptVersion: prompt.promptVersion,
            promptHash: prompt.promptHash,
            images,
            repairAttempt: repairAttempt === 1,
          });
          try {
            this.schema.assert(providerResult.decision);
            this.schema.assertEvidenceRefs(providerResult.decision, [
              ...messageProjection.map((item) => item.evidenceRef),
              ...transcriptionProjection
                .map((item) => item.evidenceRef)
                .filter((item): item is string => typeof item === 'string'),
              ...images.map((item) => item.evidenceRef),
            ]);
            proposal = providerResult.decision;
            break;
          } catch {
            if (repairAttempt === 1)
              throw new InboxProviderError('decision_schema_invalid', false);
          }
        }
      } catch (error) {
        await this.recordBatchFailure(batch, error);
        return null;
      }
      if (!providerResult || !proposal) return null;
      const actionPlan = await this.actionPlanner.plan({
        tenantId: batch.tenantId,
        workspaceId: batch.workspaceId,
        businessMode: conversation.businessMode,
        opportunity,
        decision: proposal,
      });
      return await this.dataSource.transaction(async (manager) => {
        const lockedBatch = await manager
          .getRepository(InboxProcessingBatchEntity)
          .findOne({
            where: {
              id: batch.id,
              tenantId: batch.tenantId,
              workspaceId: batch.workspaceId,
            },
            lock: { mode: 'pessimistic_write' },
          });
        const lockedConversation = await manager
          .getRepository(InboxConversationEntity)
          .findOne({
            where: {
              id: conversation.id,
              tenantId: batch.tenantId,
              workspaceId: batch.workspaceId,
            },
            lock: { mode: 'pessimistic_read' },
          });
        if (
          !lockedBatch ||
          !lockedConversation ||
          lockedConversation.ownershipState !== 'ai_active' ||
          lockedConversation.ownershipVersion !== conversation.ownershipVersion
        ) {
          if (lockedBatch) {
            lockedBatch.status = 'cancelled';
            lockedBatch.errorCode = 'ownership_changed';
            lockedBatch.completedAt = new Date();
            await manager
              .getRepository(InboxProcessingBatchEntity)
              .save(lockedBatch);
          }
          return null;
        }
        const decision = await manager
          .getRepository(InboxAgentDecisionEntity)
          .save({
            tenantId: batch.tenantId,
            workspaceId: batch.workspaceId,
            conversationId: batch.conversationId,
            batchId: batch.id,
            agentId: agent?.id ?? conversation.assignedAgentId,
            agentVersionId: version?.id ?? null,
            ownershipVersion: conversation.ownershipVersion,
            schemaVersion: 1,
            idempotencyKey: `batch:${batch.id}:decision:v1`,
            correlationId,
            status: 'proposed',
            proposal,
            policyResult: {
              mode: 'supervised',
              automaticEffectsAllowed: false,
              automaticReplyAllowed: this.config.autoReplyEnabled,
              automaticCrmAllowed: this.config.autoCrmEnabled,
              mediaContext: this.mediaPolicy(media, derivatives),
            },
            contextSnapshot: {
              conversationId: conversation.id,
              opportunityId: opportunity?.id ?? null,
              businessMode: conversation.businessMode,
              messageRefs: messageProjection.map(({ id, occurredAt }) => ({
                id,
                occurredAt,
              })),
              mediaRefs: media.map(({ id, kind, status }) => ({
                id,
                kind,
                status,
              })),
              companyContextVersion:
                settings?.companyContextPublishedVersion ?? 0,
              companyContextHash: settings?.companyContextPublishedHash ?? null,
            },
            errorCode: null,
            provider: providerResult.provider,
            model: providerResult.model,
            promptVersion: prompt.promptVersion,
            promptHash: prompt.promptHash,
            contextVersion: settings?.companyContextPublishedVersion ?? 0,
            contextHash: settings?.companyContextPublishedHash ?? null,
            promptLayers: prompt.layers,
            usage: providerResult.usage,
            latencyMs: providerResult.latencyMs,
            actionPlan,
            appliedActions: [],
            appliedAt: null,
            reviewedBy: null,
            reviewedAt: null,
          });
        lockedBatch.status = 'completed';
        lockedBatch.completedAt = new Date();
        lockedBatch.errorCode = null;
        await manager
          .getRepository(InboxProcessingBatchEntity)
          .save(lockedBatch);
        await manager.getRepository(InboxDomainOutboxEntity).save({
          tenantId: batch.tenantId,
          workspaceId: batch.workspaceId,
          aggregateType: 'inbox_agent_decision',
          aggregateId: decision.id,
          eventName: 'leadflow.inbox.agent_decision.updated',
          eventVersion: 1,
          idempotencyKey: `decision:${decision.id}:proposed`,
          payload: {
            conversationId: conversation.id,
            decisionId: decision.id,
            status: decision.status,
            ownershipVersion: decision.ownershipVersion,
          },
          publishedAt: null,
          status: 'pending',
          attempts: 0,
          availableAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          deadLetteredAt: null,
          updatedAt: new Date(),
        });
        return decision;
      });
    } finally {
      await this.publishOperationalStatus(
        batch,
        agent.id,
        RoomAgentOperationalStatus.Available,
        'processing_finished',
      );
    }
  }

  private async publishOperationalStatus(
    batch: InboxProcessingBatchEntity,
    agentId: string,
    nextStatus: RoomAgentOperationalStatus,
    phase: string,
  ) {
    if (!this.operationsRoomState) return;
    try {
      await this.operationsRoomState.recordTransition({
        tenantId: batch.tenantId,
        workspaceId: batch.workspaceId,
        agentId,
        nextStatus,
        occurredAt: new Date(),
        source: RoomOperationalSource.AgentRuntime,
        sourceEventId: `inbox-batch:${batch.id}:attempt:${batch.attemptCount}:${phase}`,
        reasonCode: `inbox_${phase}`,
        correlationId: batch.id,
      });
    } catch (error) {
      this.logger.warn(
        `Falha ao publicar telemetria ${phase} do agente ${agentId}: ${runtimeTelemetryErrorCode(error)}`,
      );
    }
  }

  async list(ctx: RequestContext, conversationId: string) {
    if (!ctx.workspaceId) return [];
    return this.dataSource.getRepository(InboxAgentDecisionEntity).find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        conversationId,
      },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async previewReview(
    ctx: RequestContext,
    conversationId: string,
    decisionId: string,
    actionKeys: string[] = [],
  ) {
    if (!ctx.workspaceId) throw new NotFoundException('Decision not found.');
    const decision = await this.dataSource
      .getRepository(InboxAgentDecisionEntity)
      .findOneBy({
        id: decisionId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        conversationId,
      });
    const conversation = await this.dataSource
      .getRepository(InboxConversationEntity)
      .findOneBy({
        id: conversationId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      });
    if (!decision || !conversation) {
      throw new NotFoundException('Decision not found.');
    }
    const opportunity = await this.dataSource
      .getRepository(CrmOpportunityEntity)
      .findOneBy(
        conversation.opportunityId
          ? {
              id: conversation.opportunityId,
              tenantId: ctx.tenantId,
              workspaceId: ctx.workspaceId,
            }
          : {
              inboxConversationId: conversation.id,
              tenantId: ctx.tenantId,
              workspaceId: ctx.workspaceId,
            },
      );
    const selected = new Set(actionKeys);
    const plan = Array.isArray(decision.actionPlan) ? decision.actionPlan : [];
    return {
      decisionId: decision.id,
      status: decision.status,
      reviewable:
        decision.status === 'proposed' &&
        decision.ownershipVersion === conversation.ownershipVersion &&
        conversation.ownershipState === 'ai_active',
      ownership: {
        currentVersion: conversation.ownershipVersion,
        decisionVersion: decision.ownershipVersion,
        state: conversation.ownershipState,
      },
      current: {
        stageId: opportunity?.stageId ?? null,
        priority: opportunity?.priority ?? null,
        service:
          typeof opportunity?.businessContext?.service === 'string'
            ? opportunity.businessContext.service
            : null,
        ownershipState: conversation.ownershipState,
      },
      proposed: plan.map((action) => ({
        key: recordString(action.key),
        type: recordString(action.type),
        value: typeof action.value === 'string' ? action.value : null,
        selected: selected.has(recordString(action.key)),
        allowed: action.allowed === true,
        reason: typeof action.reason === 'string' ? action.reason : null,
        effect:
          action.type === 'handoff' || action.type === 'close'
            ? 'ownership'
            : 'crm',
        idempotencyKey: `decision:${decision.id}:action:${recordString(action.key)}`,
      })),
      rejectedByPolicy: plan
        .filter((action) => action.allowed !== true)
        .map((action) => ({
          key: recordString(action.key),
          reason:
            typeof action.reason === 'string'
              ? action.reason
              : 'policy_rejected',
        })),
      externalEffects: [],
    };
  }

  async review(
    ctx: RequestContext,
    conversationId: string,
    decisionId: string,
    approve: boolean,
    actionKeys: string[] = [],
    approvalKind: 'analysis' | 'actions' = actionKeys.length
      ? 'actions'
      : 'analysis',
  ) {
    if (!ctx.workspaceId || !ctx.userId)
      throw new NotFoundException('Decision not found.');
    const reviewerUserId = ctx.userId;
    return this.dataSource.transaction(async (manager) => {
      const decision = await manager
        .getRepository(InboxAgentDecisionEntity)
        .findOne({
          where: {
            id: decisionId,
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId!,
            conversationId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!decision) throw new NotFoundException('Decision not found.');
      const uniqueKeys = [...new Set(actionKeys)].slice(0, 30);
      if (approve && approvalKind === 'actions' && uniqueKeys.length === 0) {
        throw new BadRequestException(
          'Select at least one action or approve the analysis without actions.',
        );
      }
      const requestedOutcome = approve
        ? resolveDecisionReviewOutcome(
            Array.isArray(decision.actionPlan) ? decision.actionPlan : [],
            approvalKind,
            uniqueKeys,
          )
        : 'decision_rejected';
      if (
        decision.status === 'approved' &&
        requestedOutcome === 'analysis_approved' &&
        decision.reviewOutcome === requestedOutcome &&
        sameReviewActionKeys(decision.reviewedActionKeys, uniqueKeys)
      ) {
        const currentConversation = await manager
          .getRepository(InboxConversationEntity)
          .findOneBy({
            id: conversationId,
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId!,
          });
        if (
          !currentConversation ||
          currentConversation.ownershipVersion !== decision.ownershipVersion ||
          currentConversation.ownershipState !== 'ai_active'
        ) {
          throw new ConflictException(
            'Decision ownership changed and must be regenerated.',
          );
        }
        return decision;
      }
      if (
        decision.status === 'approved' &&
        decision.reviewOutcome !== 'analysis_approved'
      ) {
        throw new ConflictException('Decision actions were already applied.');
      }
      if (decision.status !== 'proposed')
        throw new ConflictException('Decision is no longer pending review.');
      const conversation = await manager
        .getRepository(InboxConversationEntity)
        .findOneBy({
          id: conversationId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId!,
        });
      if (
        !conversation ||
        conversation.ownershipVersion !== decision.ownershipVersion ||
        conversation.ownershipState !== 'ai_active'
      ) {
        throw new ConflictException(
          'Decision ownership changed and must be regenerated.',
        );
      }

      decision.status = approve ? 'approved' : 'rejected';
      decision.reviewOutcome = requestedOutcome;
      decision.reviewedActionKeys = uniqueKeys;
      if (approve) {
        const plan = Array.isArray(decision.actionPlan)
          ? decision.actionPlan
          : [];
        const selected = uniqueKeys.map((key) =>
          plan.find((item) => item.key === key),
        );
        if (selected.some((item) => !item || item.allowed !== true)) {
          throw new ConflictException(
            'One or more actions are no longer allowed.',
          );
        }
        await this.applyApprovedActions(
          manager,
          ctx,
          conversation,
          decision,
          selected as Array<Record<string, unknown>>,
        );
        decision.appliedActions = selected as Array<Record<string, unknown>>;
        decision.appliedAt = uniqueKeys.length ? new Date() : null;
      }
      decision.reviewedBy = reviewerUserId;
      decision.reviewedAt = new Date();
      const saved = await manager
        .getRepository(InboxAgentDecisionEntity)
        .save(decision);
      await manager.getRepository(InboxConversationEventEntity).save({
        tenantId: saved.tenantId,
        workspaceId: saved.workspaceId,
        conversationId: saved.conversationId,
        eventType: 'agent_decision_reviewed',
        actorType: 'user',
        actorUserId: reviewerUserId,
        payload: {
          decisionId: saved.id,
          outcome: saved.reviewOutcome,
          selectedActionCount: saved.reviewedActionKeys.length,
          ownershipVersion: saved.ownershipVersion,
        },
      });
      await manager.getRepository(InboxDomainOutboxEntity).save({
        tenantId: saved.tenantId,
        workspaceId: saved.workspaceId,
        aggregateType: 'inbox_agent_decision',
        aggregateId: saved.id,
        eventName: 'leadflow.inbox.agent_decision.updated',
        eventVersion: 1,
        idempotencyKey: `decision:${saved.id}:review:${saved.reviewOutcome}`,
        payload: {
          conversationId: saved.conversationId,
          decisionId: saved.id,
          status: saved.status,
          reviewOutcome: saved.reviewOutcome,
          selectedActionCount: saved.reviewedActionKeys.length,
          ownershipVersion: saved.ownershipVersion,
        },
        publishedAt: null,
        status: 'pending',
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        deadLetteredAt: null,
        updatedAt: new Date(),
      });
      return saved;
    });
  }

  private async applyApprovedActions(
    manager: import('typeorm').EntityManager,
    ctx: RequestContext,
    conversation: InboxConversationEntity,
    decision: InboxAgentDecisionEntity,
    actions: Array<Record<string, unknown>>,
  ) {
    const opportunity = await manager
      .getRepository(CrmOpportunityEntity)
      .findOne({
        where: conversation.opportunityId
          ? {
              id: conversation.opportunityId,
              tenantId: conversation.tenantId,
              workspaceId: conversation.workspaceId,
            }
          : {
              inboxConversationId: conversation.id,
              tenantId: conversation.tenantId,
              workspaceId: conversation.workspaceId,
            },
        lock: { mode: 'pessimistic_write' },
      });
    for (const action of actions) {
      const type = action.type;
      if (
        type === 'set_stage' &&
        opportunity &&
        typeof action.stageId === 'string'
      ) {
        opportunity.stageId = action.stageId;
      } else if (
        type === 'set_summary' &&
        opportunity &&
        typeof action.value === 'string'
      ) {
        opportunity.businessContext = {
          ...opportunity.businessContext,
          agentSummary: action.value,
        };
      } else if (
        type === 'add_tag' &&
        opportunity &&
        typeof action.value === 'string'
      ) {
        await manager.query(
          `INSERT INTO crm_opportunity_tags (tenant_id, workspace_id, opportunity_id, tag_id, assigned_by_type, assigned_by_user_id, metadata)
           SELECT $1, $2, $3, tag.id, 'user', $4, jsonb_build_object('agentDecisionId', $5)
           FROM crm_tags tag
           WHERE tag.tenant_id = $1 AND tag.workspace_id = $2 AND tag.slug = $6 AND tag.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM crm_opportunity_tags link WHERE link.tenant_id = $1 AND link.workspace_id = $2 AND link.opportunity_id = $3 AND link.tag_id = tag.id)`,
          [
            conversation.tenantId,
            conversation.workspaceId,
            opportunity.id,
            ctx.userId,
            decision.id,
            slugValue(action.value),
          ],
        );
      } else if (
        type === 'set_service' &&
        opportunity &&
        typeof action.value === 'string'
      ) {
        opportunity.businessContext = {
          ...opportunity.businessContext,
          service: action.value,
        };
      } else if (
        type === 'set_urgency' &&
        opportunity &&
        typeof action.value === 'string' &&
        ['low', 'normal', 'high', 'urgent'].includes(action.value)
      ) {
        opportunity.priority = action.value;
        opportunity.businessContext = {
          ...opportunity.businessContext,
          urgency: action.value,
        };
      } else if (type === 'close' && typeof action.value === 'string') {
        conversation.qualificationStatus = 'disqualified';
        conversation.qualificationReason = action.value;
        conversation.status =
          action.value === 'archived' ? 'archived' : 'closed';
        conversation.ownershipState = 'closed';
        conversation.aiEnabled = false;
        conversation.ownershipVersion += 1;
        conversation.closedAt = new Date();
        if (action.value === 'archived') conversation.archivedAt = new Date();
        if (opportunity) {
          opportunity.status =
            action.value === 'lost' ? 'lost' : opportunity.status;
          opportunity.lostAt =
            action.value === 'lost' ? new Date() : opportunity.lostAt;
          opportunity.lostReason = action.value;
          opportunity.businessContext = {
            ...opportunity.businessContext,
            leadDisposition: action.value,
          };
        }
      } else if (type === 'handoff') {
        conversation.ownershipState = 'handoff_requested';
        conversation.aiEnabled = false;
        conversation.ownershipVersion += 1;
        conversation.ownershipReason =
          typeof action.value === 'string'
            ? action.value.slice(0, 180)
            : 'agent_decision_approved';
        conversation.ownershipChangedAt = new Date();
        conversation.status = 'handoff_requested';
      }
    }
    if (opportunity)
      await manager.getRepository(CrmOpportunityEntity).save(opportunity);
    await manager.getRepository(InboxConversationEntity).save(conversation);
  }

  assertValidProposal(value: unknown): asserts value is AgentDecisionProposal {
    this.schema.assert(value);
  }

  private async loadImages(media: InboxMediaAssetEntity[]) {
    const images: Array<{
      assetId: string;
      evidenceRef: string;
      mimeType: string;
      bytes: Buffer;
    }> = [];
    for (const asset of media) {
      if (images.length >= this.config.maxImagesPerRun) break;
      if (
        asset.kind !== 'image' ||
        asset.status !== 'available' ||
        !asset.objectKey ||
        !asset.mimeType ||
        Number(asset.byteSize ?? 0) > this.config.maxImageBytes
      )
        continue;
      const file = await this.files.getPrivateAsset(asset.objectKey);
      images.push({
        assetId: asset.id,
        evidenceRef: `image:${asset.id}`,
        mimeType: asset.mimeType,
        bytes: await readStream(file.body, this.config.maxImageBytes),
      });
    }
    return images;
  }

  private async loadVisionFallback(
    media: InboxMediaAssetEntity[],
    derivatives: InboxMediaDerivativeEntity[],
  ): Promise<Array<Record<string, unknown>>> {
    const output: Array<Record<string, unknown>> = [];
    for (const asset of media) {
      if (output.length >= this.config.maxImagesPerRun) break;
      if (
        asset.kind !== 'image' ||
        asset.status !== 'available' ||
        !asset.objectKey ||
        !asset.mimeType ||
        !asset.checksum
      )
        continue;
      const cached = derivatives.find(
        (item) =>
          item.mediaAssetId === asset.id &&
          item.kind === 'vision' &&
          item.processorVersion === this.config.visionProcessorVersion &&
          item.assetChecksum === asset.checksum &&
          item.status === 'available',
      );
      if (cached) {
        output.push({
          assetId: asset.id,
          kind: 'vision_fallback',
          text: cached.content?.slice(0, 4_000) ?? '',
        });
        continue;
      }
      const file = await this.files.getPrivateAsset(asset.objectKey);
      const bytes = await readStream(file.body, this.config.maxImageBytes);
      const result = await this.provider.analyzeImage({
        tenantId: asset.tenantId,
        workspaceId: asset.workspaceId,
        assetId: asset.id,
        mimeType: asset.mimeType,
        checksum: asset.checksum,
        bytes,
        idempotencyKey: `vision:${asset.workspaceId}:${asset.checksum}:${this.config.visionProcessorVersion}`,
      });
      await this.dataSource.getRepository(InboxMediaDerivativeEntity).upsert(
        {
          tenantId: asset.tenantId,
          workspaceId: asset.workspaceId,
          mediaAssetId: asset.id,
          kind: 'vision',
          status: 'available',
          content: result.text,
          language: null,
          confidence: null,
          provider: result.provider,
          model: result.model,
          processorVersion: result.processorVersion,
          assetChecksum: asset.checksum,
          outcome: result.text ? 'content' : 'empty',
          attemptCount: 1,
          availableAt: new Date(),
          nextAttemptAt: null,
          lockedAt: null,
          lockedBy: null,
          completedAt: new Date(),
          usage: result.usage,
          latencyMs: result.latencyMs,
          metadata: { fallback: true },
          errorCode: null,
        },
        ['tenantId', 'workspaceId', 'mediaAssetId', 'kind', 'processorVersion'],
      );
      output.push({
        assetId: asset.id,
        kind: 'vision_fallback',
        text: result.text.slice(0, 4_000),
      });
    }
    return output;
  }

  private async recordBatchFailure(
    batch: InboxProcessingBatchEntity,
    error: unknown,
  ) {
    const code = providerErrorCode(error);
    const retryable = error instanceof InboxProviderError && error.retryable;
    await this.dataSource.getRepository(InboxProcessingBatchEntity).update(
      {
        id: batch.id,
        tenantId: batch.tenantId,
        workspaceId: batch.workspaceId,
      },
      retryable && batch.attemptCount < 3
        ? {
            status: 'pending',
            dueAt: new Date(
              Date.now() + 15_000 * 2 ** Math.max(0, batch.attemptCount - 1),
            ),
            claimedAt: null,
            claimedBy: null,
            errorCode: code,
          }
        : { status: 'failed', completedAt: new Date(), errorCode: code },
    );
  }
  private mediaPolicy(
    media: InboxMediaAssetEntity[],
    derivatives: InboxMediaDerivativeEntity[],
  ) {
    const needed = media.filter((item) => item.kind === 'audio');
    if (!needed.length) return 'complete';
    if (needed.some((asset) => asset.status !== 'available')) return 'blocked';
    return needed.every((asset) =>
      derivatives.some(
        (item) => item.mediaAssetId === asset.id && item.status === 'available',
      ),
    )
      ? 'complete'
      : 'partial';
  }
  private async resolveAgent(
    batch: InboxProcessingBatchEntity,
    conversation: InboxConversationEntity,
  ) {
    const qb = this.dataSource
      .getRepository(LeadFlowAgentEntity)
      .createQueryBuilder('agent')
      .innerJoin(
        LeadFlowAgentChannelBindingEntity,
        'binding',
        [
          'binding.agent_id = agent.id',
          'binding.tenant_id = agent.tenant_id',
          'binding.workspace_id = agent.workspace_id',
        ].join(' AND '),
      )
      .where(
        'agent.tenant_id = :tenantId AND agent.workspace_id = :workspaceId',
        batch,
      )
      .andWhere(
        "agent.status = 'active' AND agent.published_version_id IS NOT NULL",
      )
      .andWhere("binding.status = 'active'")
      .andWhere(
        "(binding.external_ref = :channelId OR binding.config->>'channelId' = :channelId)",
        {
          channelId: batch.channelId,
        },
      );
    if (conversation.assignedAgentId) {
      qb.andWhere('agent.id = :assignedAgentId', {
        assignedAgentId: conversation.assignedAgentId,
      });
    }
    return qb.orderBy('agent.updated_at', 'DESC').getOne();
  }
}

async function readStream(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const part = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    size += part.length;
    if (size > limit)
      throw new InboxProviderError('image_size_not_allowed', false);
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function providerErrorCode(error: unknown): string {
  const value =
    error instanceof InboxProviderError
      ? error.code
      : error instanceof Error
        ? error.message
        : 'decision_provider_failed';
  return /^[a-z0-9_]{1,80}$/.test(value) ? value : 'decision_provider_failed';
}

function runtimeTelemetryErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : 'unknown_error';
  return /^[a-z0-9_.: -]{1,120}$/i.test(value)
    ? value
    : 'telemetry_publish_failed';
}

function slugValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function recordString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
