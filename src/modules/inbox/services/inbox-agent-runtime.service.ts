import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { Readable } from 'stream';
import { DataSource, IsNull } from 'typeorm';
import { FilesService } from '../../../common/files/files.service';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import {
  CrmAiStageTransitionCatalog,
  CrmStageTransitionPolicyService,
} from '../../crm/services/crm-stage-transition-policy.service';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities/leadflow-agent.entity';
import { resolveAgentRolePolicy } from '../../leadflow-agents/catalog/agent-role-policy.catalog';
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
import { readConversationPlaybook } from '../../leadflow-settings/types/conversation-playbook.types';
import { getCatalogConversationPlaybook } from '../../leadflow-settings/catalog/business-mode-templates.catalog';
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
import { InboxGovernedActionEntity } from '../entities/inbox-governed-action.entity';
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
import { resolveRoutedCrmTarget } from '../runtime/inbox-crm-target-resolver';
import {
  InboxGovernedActionType,
  InboxGovernedAutonomyPolicyService,
  INBOX_AUTONOMY_POLICY_VERSION,
} from '../runtime/inbox-governed-autonomy-policy.service';
import { InboxPilotOutboundPolicyService } from '../channels/whatsapp/services/inbox-pilot-outbound-policy.service';
import {
  type CanonicalConversationFact,
  ConversationPlaybookStateService,
  PLAYBOOK_PROGRESS_METADATA_KEY,
} from '../runtime/conversation-playbook-state.service';

export type AgentDecisionProposal = AgentDecisionV1;

export function canonicalConversationFacts(input: {
  conversationTitle?: string | null;
  opportunityContactName?: string | null;
}): Record<string, CanonicalConversationFact> {
  const candidate = (
    input.opportunityContactName ??
    input.conversationTitle ??
    ''
  )
    .trim()
    .replace(/\s+/g, ' ');
  const isGeneric =
    !candidate ||
    /^\+?\d[\d\s()-]+$/.test(candidate) ||
    /^(contato( do whatsapp)?|whatsapp|sem nome)$/i.test(candidate);
  if (isGeneric) return {};
  return {
    lead_name: {
      value: candidate.slice(0, 160),
      evidenceRefs: ['channel:profile_name'],
      confidence: 1,
    },
  };
}

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

export function projectConversationEvidence(
  messages: InboxMessageEntity[],
  media: InboxMediaAssetEntity[],
  derivatives: InboxMediaDerivativeEntity[],
) {
  const mediaById = new Map(media.map((asset) => [asset.id, asset]));
  const transcriptions = derivatives
    .filter(
      (item) => item.kind === 'transcription' && item.status === 'available',
    )
    .flatMap((item) => {
      const asset = mediaById.get(item.mediaAssetId);
      if (!asset) return [];
      return [
        {
          assetId: item.mediaAssetId,
          messageId: asset.messageId,
          messageEvidenceRef: `message:${asset.messageId}`,
          evidenceRef: `transcription:${item.mediaAssetId}`,
          kind: 'transcription',
          outcome: item.outcome,
          text: item.content?.slice(0, 4_000) ?? '',
          language: item.language,
        },
      ];
    });
  const transcriptionByAssetId = new Map(
    transcriptions.map((item) => [item.assetId, item]),
  );
  const assetsByMessageId = new Map<string, InboxMediaAssetEntity[]>();
  for (const asset of media) {
    const current = assetsByMessageId.get(asset.messageId) ?? [];
    current.push(asset);
    assetsByMessageId.set(asset.messageId, current);
  }

  return {
    messages: messages.map((message) => ({
      id: message.id,
      evidenceRef: `message:${message.id}`,
      direction: message.direction,
      senderType: message.senderType,
      type: message.messageType,
      content: message.content.slice(0, 2_000),
      occurredAt: message.occurredAt.toISOString(),
      providerSequence: message.providerSequence,
      media: (assetsByMessageId.get(message.id) ?? []).map((asset) => ({
        assetId: asset.id,
        kind: asset.kind,
        status: asset.status,
        transcription: transcriptionByAssetId.get(asset.id) ?? null,
      })),
    })),
    transcriptions,
  };
}

export function isAppointmentHandoffMode(
  template: LeadFlowBusinessModeTemplateEntity | null,
) {
  if (!template) return false;
  const recommendsAppointments = template.recommendedApps.some(
    (item) => item.key === 'appointments' && item.recommended !== false,
  );
  if (recommendsAppointments) return true;
  return /agend|reuni|diagn[oó]stic|or[cç]amento/i.test(
    JSON.stringify(template.conversionGoals),
  );
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
    @Optional()
    private readonly autonomyPolicy?: InboxGovernedAutonomyPolicyService,
    @Optional()
    private readonly pilotOutboundPolicy?: InboxPilotOutboundPolicyService,
    @Optional()
    private readonly playbookState?: ConversationPlaybookStateService,
    @Optional()
    private readonly opportunityCommands?: CrmOpportunityCommandService,
    @Optional()
    private readonly transitionPolicies?: CrmStageTransitionPolicyService,
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

  async triggerManual(ctx: RequestContext, conversationId: string) {
    if (!ctx.workspaceId || !ctx.userId) {
      throw new NotFoundException('Processing batch not found.');
    }
    const batchId = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(
        `SELECT batch.id
           FROM inbox_processing_batches batch
           JOIN inbox_conversations conversation
             ON conversation.id = batch.conversation_id
            AND conversation.tenant_id = batch.tenant_id
            AND conversation.workspace_id = batch.workspace_id
          WHERE batch.tenant_id = $1 AND batch.workspace_id = $2
            AND batch.conversation_id = $3 AND batch.status = 'pending'
            AND batch.due_at <= now() AND batch.attempt_count < 3
            AND conversation.ownership_state = 'ai_active'
            AND conversation.ai_enabled = true
          ORDER BY batch.due_at, batch.id
          FOR UPDATE OF batch SKIP LOCKED LIMIT 1`,
        [ctx.tenantId, ctx.workspaceId, conversationId],
      );
      if (!rows[0]) return null;
      await manager
        .getRepository(InboxProcessingBatchEntity)
        .update(rows[0].id, {
          status: 'processing',
          claimedAt: new Date(),
          claimedBy: `manual:${ctx.userId}`,
          attemptCount: () => 'attempt_count + 1',
        });
      return rows[0].id;
    });
    if (!batchId) throw new NotFoundException('Processing batch not found.');
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
    const activeOpportunities = await this.dataSource
      .getRepository(CrmOpportunityEntity)
      .find({
        where: {
          inboxConversationId: conversation.id,
          tenantId: batch.tenantId,
          workspaceId: batch.workspaceId,
          status: 'open',
          deletedAt: IsNull(),
        },
        take: 2,
      });
    if (activeOpportunities.length > 1) {
      await this.dataSource
        .getRepository(InboxProcessingBatchEntity)
        .update(batch.id, {
          status: 'cancelled',
          errorCode: 'multiple_active_opportunities',
          completedAt: new Date(),
        });
      return null;
    }
    const activeOpportunityCandidate = activeOpportunities[0] ?? null;
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
      const effectiveBusinessMode =
        settings?.businessModeKey ?? conversation.businessMode;
      const incompatibleActiveOpportunity = Boolean(
        activeOpportunityCandidate &&
        activeOpportunityCandidate.businessMode !== effectiveBusinessMode,
      );
      const opportunity = incompatibleActiveOpportunity
        ? null
        : activeOpportunityCandidate;
      const persistedConversationPlaybook = readConversationPlaybook(
        businessModeTemplate?.metadata,
      );
      const catalogConversationPlaybook = getCatalogConversationPlaybook(
        effectiveBusinessMode,
      );
      const conversationPlaybook =
        persistedConversationPlaybook &&
        persistedConversationPlaybook.version >=
          (catalogConversationPlaybook?.version ?? 0)
          ? persistedConversationPlaybook
          : (catalogConversationPlaybook ?? persistedConversationPlaybook);
      const canonicalFacts = canonicalConversationFacts({
        conversationTitle: conversation.title,
        opportunityContactName: opportunity?.contactName,
      });
      const canonicalLeadName =
        typeof canonicalFacts.lead_name?.value === 'string'
          ? canonicalFacts.lead_name.value
          : null;
      const allowedServices = canonicalStringList(
        settings?.companyContextPublished?.offers,
      );
      const progressReader =
        this.playbookState ?? new ConversationPlaybookStateService();
      const currentProgress = progressReader.read(conversation.metadata);
      const stageTransitionCatalog =
        opportunity && this.transitionPolicies
          ? await this.transitionPolicies.getAiTransitionCatalog(
              {
                tenantId: batch.tenantId,
                workspaceId: batch.workspaceId,
              },
              opportunity,
            )
          : null;
      // The agent's role decides which commercial actions it may attempt; the
      // stage transition is additionally gated by the governed catalog. Offering
      // only role-permitted actions keeps the model from proposing what the
      // planner would refuse anyway (the planner still enforces it server-side).
      const rolePolicy = resolveAgentRolePolicy(agent.type);
      const roleAllows = new Set<string>(rolePolicy.allowedDecisionActions);
      const canProposeStage = Boolean(
        stageTransitionCatalog?.capabilities.canProposeStageTransition &&
          roleAllows.has('set_stage'),
      );
      const allowedActions = [
        ...(canProposeStage ? ['set_stage'] : []),
        'add_tag',
        'set_summary',
        'set_service',
        'set_urgency',
        'set_fact',
        'close',
        'handoff',
      ].filter((action) => action === 'set_stage' || roleAllows.has(action));
      const projectedEvidence = projectConversationEvidence(
        orderedMessages,
        media,
        derivatives,
      );
      const messageProjection = projectedEvidence.messages;
      const transcriptionProjection: Array<Record<string, unknown>> = [
        ...projectedEvidence.transcriptions,
      ];
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
        businessMode: effectiveBusinessMode,
        ownership: {
          state: conversation.ownershipState,
          version: conversation.ownershipVersion,
        },
        allowedActions,
        workspaceConfig: {
          clientPromptConfig: settings?.clientPromptConfig ?? {},
          businessModeOverrides: settings?.businessModeOverrides ?? {},
        },
        contact: {
          id: conversation.contactId,
          displayName: canonicalLeadName,
        },
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
        businessModeInstruction: businessModeTemplate
          ? {
              prompt: businessModeTemplate.agentPromptTemplate,
              conversionGoals: businessModeTemplate.conversionGoals,
              qualificationFields: businessModeTemplate.qualificationFields,
              handoffRules: businessModeTemplate.handoffRules,
              recommendedApps: businessModeTemplate.recommendedApps,
              conversationPlaybook,
            }
          : { key: effectiveBusinessMode },
        businessModeVersion: businessModeTemplate?.version ?? 1,
        firstAgentReply: !messageProjection.some(
          (message) =>
            message.direction === 'outbound' && message.senderType === 'agent',
        ),
        appointmentHandoffMode: isAppointmentHandoffMode(businessModeTemplate),
        conversationProgress: {
          ...(currentProgress ?? {}),
          canonicalFacts,
        },
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
        stageTransitionCatalog,
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
            businessMode: effectiveBusinessMode,
            workspaceConfig: settings?.agentConfig ?? {},
            contact: {
              id: conversation.contactId,
              displayName: canonicalLeadName,
            },
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
            allowedActions,
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
            if (conversationPlaybook) {
              progressReader.assertDecision({
                previous: currentProgress,
                playbook: conversationPlaybook,
                decision: providerResult.decision,
                priorAgentReplies: messageProjection.filter(
                  (message) =>
                    message.direction === 'outbound' &&
                    message.senderType === 'agent',
                ).length,
                canonicalFacts,
              });
            }
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
        businessMode: effectiveBusinessMode,
        opportunity,
        decision: proposal,
        playbook: conversationPlaybook,
        opportunityWillBeEnsured:
          conversation.qualificationStatus === 'qualified' &&
          !incompatibleActiveOpportunity,
        allowedServices,
        transitionCatalog: stageTransitionCatalog,
        allowedDecisionActions: roleAllows,
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
        const latestInbound = await manager
          .getRepository(InboxMessageEntity)
          .findOne({
            where: {
              tenantId: batch.tenantId,
              workspaceId: batch.workspaceId,
              conversationId: batch.conversationId,
              direction: 'inbound',
            },
            order: { occurredAt: 'DESC', createdAt: 'DESC' },
          });
        const contextInbound = [...messageProjection]
          .reverse()
          .find((message) => message.direction === 'inbound');
        const routedCrmTarget = await resolveRoutedCrmTarget(manager, {
          tenantId: batch.tenantId,
          workspaceId: batch.workspaceId,
          channelId: lockedConversation.channelId,
          businessMode: effectiveBusinessMode,
        });
        const defaultPipeline = routedCrmTarget.ok
          ? routedCrmTarget.pipeline
          : null;
        const initialStage = routedCrmTarget.ok
          ? routedCrmTarget.initialStage
          : null;
        const identityDigits = lockedConversation.externalThreadId?.replace(
          /\D/g,
          '',
        );
        const identityMatches = identityDigits
          ? await manager.query<Array<{ id: string; status: string }>>(
              `SELECT DISTINCT contact.id, contact.status
                 FROM contacts contact
                 JOIN contact_methods method
                   ON method.contact_id = contact.id
                  AND method.tenant_id = contact.tenant_id
                  AND method.workspace_id = contact.workspace_id
                WHERE contact.tenant_id = $1 AND contact.workspace_id = $2
                  AND method.type IN ('phone', 'whatsapp')
                  AND regexp_replace(method.value, '\\D', '', 'g') = $3`,
              [batch.tenantId, batch.workspaceId, identityDigits],
            )
          : [];
        const activeOwners = await manager
          .getRepository(AgencyWorkspaceUserEntity)
          .find({
            where: {
              tenantId: batch.tenantId,
              workspaceId: batch.workspaceId,
              role: 'owner',
              status: 'active',
            },
            take: 2,
          });
        const decisionId = randomUUID();
        await manager.query(
          `INSERT INTO inbox_autonomy_controls (tenant_id,workspace_id)
           VALUES ($1,$2) ON CONFLICT (tenant_id,workspace_id) DO NOTHING`,
          [batch.tenantId, batch.workspaceId],
        );
        if (lockedConversation.businessMode !== effectiveBusinessMode) {
          lockedConversation.businessMode = effectiveBusinessMode;
        }
        if (conversationPlaybook) {
          const nextProgress = progressReader.apply({
            previous: progressReader.read(lockedConversation.metadata),
            playbook: conversationPlaybook,
            decision: proposal,
            decisionId,
            conversionKey: `conversation:${lockedConversation.id}:generation:${batch.generation}`,
            contactId: lockedConversation.contactId,
            opportunityId: opportunity?.id ?? null,
            canonicalFacts,
          });
          lockedConversation.metadata = {
            ...lockedConversation.metadata,
            [PLAYBOOK_PROGRESS_METADATA_KEY]: nextProgress,
          };
        }
        await manager
          .getRepository(InboxConversationEntity)
          .save(lockedConversation);
        const policyActions = this.evaluateGovernedActions({
          decisionId,
          batch,
          conversation: lockedConversation,
          channel,
          agentId: agent.id,
          agentVersionId: version.id,
          proposal,
          actionPlan,
          promptVersion: prompt.promptVersion,
          modelVersion: providerResult.model,
          companyContextPublished:
            Boolean(settings?.companyContextPublishedVersion) &&
            Boolean(settings?.companyContextPublishedHash),
          companyContext: settings?.companyContextPublished ?? {},
          companyContextHash: settings?.companyContextPublishedHash ?? null,
          latestContext: Boolean(
            latestInbound &&
            contextInbound &&
            latestInbound.id === contextInbound.id,
          ),
          latestInbound,
          recipientAllowed: (
            this.pilotOutboundPolicy ?? new InboxPilotOutboundPolicyService()
          ).isAuthorized(lockedConversation.externalThreadId),
          humanRouteConfigured: Boolean(
            channel.defaultAssignedUserId ||
            (settings?.handoffOverrides &&
              Object.keys(settings.handoffOverrides).length) ||
            (activeOwners.length === 1 && activeOwners[0].userId),
          ),
          opportunityDefaultsResolved: Boolean(
            defaultPipeline && initialStage && !incompatibleActiveOpportunity,
          ),
          defaultPipelineId: defaultPipeline?.id ?? null,
          initialStageId: initialStage?.id ?? null,
          canonicalIdentityResolved: Boolean(
            identityDigits &&
            identityMatches.length <= 1 &&
            identityMatches[0]?.status !== 'archived',
          ),
          activeOpportunityResolved: Boolean(opportunity),
        });
        const decision = await manager
          .getRepository(InboxAgentDecisionEntity)
          .save({
            id: decisionId,
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
              mode: 'governed',
              policyVersion: INBOX_AUTONOMY_POLICY_VERSION,
              automaticEffectsAllowed:
                this.config.autoReplyEnabled ||
                this.config.autoCrmEnabled ||
                this.config.autoHandoffEnabled,
              automaticReplyAllowed: this.config.autoReplyEnabled,
              automaticCrmAllowed: this.config.autoCrmEnabled,
              automaticHandoffAllowed: this.config.autoHandoffEnabled,
              actions: policyActions,
              mediaContext: this.mediaPolicy(media, derivatives),
            },
            contextSnapshot: {
              conversationId: conversation.id,
              opportunityId: opportunity?.id ?? null,
              businessMode: effectiveBusinessMode,
              businessModeVersion: businessModeTemplate?.version ?? 1,
              playbookVersion: conversationPlaybook?.version ?? null,
              playbookPhase:
                progressReader.read(lockedConversation.metadata)?.phase ?? null,
              messageRefs: messageProjection.map(({ id, occurredAt }) => ({
                id,
                occurredAt,
              })),
              latestInboundId: contextInbound?.id ?? null,
              mediaRefs: media.map(({ id, kind, status }) => ({
                id,
                kind,
                status,
              })),
              allowedEvidenceRefs: [
                ...messageProjection.map((item) => item.evidenceRef),
                ...transcriptionProjection
                  .map((item) => item.evidenceRef)
                  .filter((item): item is string => typeof item === 'string'),
                ...images.map((item) => item.evidenceRef),
              ],
              stageTransitionCatalog: this.transitionCatalogSnapshot(
                stageTransitionCatalog,
              ),
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
        await manager.getRepository(InboxGovernedActionEntity).save(
          policyActions.map((action) => ({
            tenantId: action.tenantId,
            workspaceId: action.workspaceId,
            conversationId: action.conversationId,
            decisionId: action.decisionId,
            ownershipVersion: action.ownershipVersion,
            policyVersion: action.policyVersion,
            actionType: action.actionType,
            actionKey: action.actionKey,
            policyOutcome: action.outcome,
            reasonCode: action.reasonCode,
            idempotencyKey: action.idempotencyKey,
            intentHash: createHash('sha256')
              .update(
                JSON.stringify({
                  decisionId: action.decisionId,
                  actionType: action.actionType,
                  actionKey: action.actionKey,
                  promptHash: prompt.promptHash,
                  contextVersion: settings?.companyContextPublishedVersion ?? 0,
                }),
              )
              .digest('hex'),
            auditRef: action.auditRef,
            status: action.outcome === 'allowed' ? 'planned' : action.outcome,
            canonicalRefs: action.canonicalRefs,
            applicationResult: {},
            attempts: 0,
            claimedAt: null,
            claimedBy: null,
            appliedAt: null,
            failedAt: null,
            errorCode: null,
          })),
        );
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

  private evaluateGovernedActions(input: {
    decisionId: string;
    batch: InboxProcessingBatchEntity;
    conversation: InboxConversationEntity;
    channel: InboxChannelEntity;
    agentId: string;
    agentVersionId: string;
    proposal: AgentDecisionV1;
    actionPlan: Array<Record<string, unknown>>;
    promptVersion: string;
    modelVersion: string;
    companyContextPublished: boolean;
    companyContext: Record<string, unknown>;
    companyContextHash: string | null;
    latestContext: boolean;
    latestInbound: InboxMessageEntity | null;
    recipientAllowed: boolean;
    humanRouteConfigured: boolean;
    opportunityDefaultsResolved: boolean;
    defaultPipelineId: string | null;
    initialStageId: string | null;
    canonicalIdentityResolved: boolean;
    activeOpportunityResolved: boolean;
  }) {
    const actions: Array<{
      type: InboxGovernedActionType;
      key: string;
      value?: string | null;
      resolved: boolean;
      refs?: string[];
      canonicalRefs?: string[];
    }> = [];
    actions.push({
      type: 'ensure_contact',
      key: 'contact',
      value: null,
      resolved: Boolean(
        input.conversation.contactId || input.canonicalIdentityResolved,
      ),
    });
    if (
      input.conversation.qualificationStatus === 'qualified' &&
      !input.activeOpportunityResolved
    ) {
      actions.push({
        type: 'ensure_opportunity',
        key: 'opportunity',
        value: null,
        resolved:
          input.opportunityDefaultsResolved &&
          Boolean(
            input.conversation.contactId || input.canonicalIdentityResolved,
          ),
      });
    }
    if (input.proposal.reply !== null) {
      actions.push({
        type: 'reply',
        key: 'reply',
        value: input.proposal.reply,
        resolved: true,
      });
    }
    for (const action of input.actionPlan) {
      if (!isGovernedActionType(action.type)) continue;
      actions.push({
        type: action.type,
        key: recordString(action.key),
        value: typeof action.value === 'string' ? action.value : null,
        resolved: action.allowed === true,
        refs: Array.isArray(action.evidenceRefs)
          ? action.evidenceRefs.filter(
              (ref): ref is string => typeof ref === 'string',
            )
          : [],
        canonicalRefs:
          action.type === 'set_stage'
            ? [
                ...(typeof action.opportunityId === 'string'
                  ? [`opportunity:${action.opportunityId}`]
                  : []),
                ...(typeof action.fromStageId === 'string'
                  ? [`stage:${action.fromStageId}`]
                  : []),
                ...(typeof action.stageId === 'string'
                  ? [`stage:${action.stageId}`]
                  : []),
                ...(typeof action.transitionPolicyId === 'string' &&
                typeof action.transitionPolicyVersion === 'number'
                  ? [
                      `transition-policy:${action.transitionPolicyId}:v${action.transitionPolicyVersion}`,
                    ]
                  : []),
              ]
            : [],
      });
    }
    const inboundText = input.latestInbound?.content ?? '';
    const contextText = stableLowercase(input.companyContext);
    return actions.map((action) =>
      (
        this.autonomyPolicy ?? new InboxGovernedAutonomyPolicyService()
      ).evaluate({
        tenantId: input.batch.tenantId,
        workspaceId: input.batch.workspaceId,
        conversationId: input.conversation.id,
        ownershipVersion: input.conversation.ownershipVersion,
        currentOwnershipVersion: input.conversation.ownershipVersion,
        ownershipState: input.conversation.ownershipState,
        decisionId: input.decisionId,
        decisionSchemaVersion: 1,
        promptVersion: input.promptVersion,
        modelVersion: input.modelVersion,
        actionType: action.type,
        actionKey: action.key,
        actionValue: action.value,
        canonicalRefs: [
          `channel:${input.channel.id}`,
          `agent:${input.agentId}`,
          `agent-version:${input.agentVersionId}`,
          ...(input.companyContextHash
            ? [`company-context:${input.companyContextHash}`]
            : []),
          ...(action.type === 'ensure_opportunity' && input.defaultPipelineId
            ? [`pipeline:${input.defaultPipelineId}`]
            : []),
          ...(action.type === 'ensure_opportunity' && input.initialStageId
            ? [`stage:${input.initialStageId}`]
            : []),
          ...(input.latestInbound ? [`message:${input.latestInbound.id}`] : []),
          ...(action.refs ?? []),
          ...(action.canonicalRefs ?? []),
        ],
        auditRef: randomUUID(),
        pilotMode: this.config.pilotMode,
        effectEnabled:
          action.type === 'reply'
            ? this.config.autoReplyEnabled
            : action.type === 'handoff'
              ? this.config.autoHandoffEnabled
              : this.config.autoCrmEnabled,
        recipientAllowed: input.recipientAllowed,
        channelEligible:
          input.channel.type === 'whatsapp' &&
          input.channel.status === 'active' &&
          input.channel.connectionStatus === 'connected' &&
          input.channel.aiEnabled,
        agentPublished: Boolean(input.agentVersionId),
        companyContextPublished: input.companyContextPublished,
        latestContext: input.latestContext,
        schemaValid: true,
        idempotencyAvailable: true,
        budgetAvailable: true,
        channelWindowOpen: Boolean(
          input.latestInbound &&
          Date.now() - input.latestInbound.occurredAt.getTime() <=
            24 * 60 * 60 * 1_000,
        ),
        promptInjectionDetected: detectsPromptInjection(inboundText),
        sensitiveTopicDetected: detectsSensitiveTopic(inboundText),
        factualClaimsSupported:
          action.type !== 'reply' ||
          factualReplyIsSupported(action.value ?? '', contextText),
        canonicalTargetResolved: action.resolved,
        transitionAllowed:
          action.type !== 'set_stage' || action.resolved === true,
        humanRouteConfigured: input.humanRouteConfigured,
        leadEligible: input.conversation.qualificationStatus === 'qualified',
      }),
    );
  }

  private transitionCatalogSnapshot(
    catalog: CrmAiStageTransitionCatalog | null,
  ): Record<string, unknown> | null {
    if (!catalog) return null;
    return {
      opportunityId: catalog.opportunityId,
      opportunityRowVersion: catalog.opportunityRowVersion,
      pipelineId: catalog.pipelineId,
      currentStageId: catalog.currentStageId,
      lifecycleStatus: catalog.lifecycleStatus,
      capabilities: catalog.capabilities,
      destinations: catalog.destinations.map((destination) => ({
        toStageId: destination.toStageId,
        transitionPolicyId: destination.transitionPolicyId,
        transitionPolicyVersion: destination.transitionPolicyVersion,
        reasonCodes: destination.reasonCodes,
        requiredFields: destination.requiredFields,
        missingFields: destination.missingFields,
        conditionsMet: destination.conditionsMet,
        currentlyEligible: destination.currentlyEligible,
      })),
    };
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
    const tags = opportunity
      ? await this.dataSource.query<Array<{ slug: string }>>(
          `SELECT tag.slug
             FROM crm_opportunity_tags link
             JOIN crm_tags tag ON tag.id = link.tag_id
              AND tag.tenant_id = link.tenant_id
              AND tag.workspace_id = link.workspace_id
            WHERE link.tenant_id = $1 AND link.workspace_id = $2
              AND link.opportunity_id = $3 AND tag.deleted_at IS NULL
            ORDER BY tag.slug`,
          [ctx.tenantId, ctx.workspaceId, opportunity.id],
        )
      : [];
    const current = canonicalOpportunityState(
      opportunity,
      tags.map((item) => item.slug),
      conversation.ownershipState,
    );
    const expectedVersion = previewVersion(
      decision.id,
      decision.ownershipVersion,
      current,
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
      current,
      expectedVersion,
      proposed: plan.map((action) => {
        const type = recordString(action.type);
        return {
          key: recordString(action.key),
          type,
          current: currentValueForAction(type, current),
          proposed:
            type === 'set_stage' && typeof action.stageId === 'string'
              ? action.stageId
              : typeof action.value === 'string'
                ? action.value
                : null,
          selected: selected.has(recordString(action.key)),
          allowed: action.allowed === true,
          rejectionReason:
            typeof action.reason === 'string' ? action.reason : null,
          effectType:
            action.type === 'handoff' || action.type === 'close'
              ? 'ownership'
              : 'crm',
          idempotencyKey: `decision:${decision.id}:action:${recordString(action.key)}`,
          expectedVersion,
        };
      }),
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
    idempotencyKey?: string,
    expectedVersion?: string,
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
      const reviewKey =
        idempotencyKey?.trim() ||
        `decision-review:${decision.id}:${approve ? approvalKind : 'reject'}`;
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${ctx.tenantId}:${ctx.workspaceId}:decision-review:${reviewKey}`],
      );
      const intentHash = createHash('sha256')
        .update(
          JSON.stringify({
            conversationId,
            decisionId,
            approve,
            approvalKind,
            actionKeys: [...uniqueKeys].sort(),
            ownershipVersion: decision.ownershipVersion,
            expectedVersion: expectedVersion ?? null,
          }),
        )
        .digest('hex');
      const reused = await manager
        .getRepository(InboxAgentDecisionEntity)
        .findOneBy({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId!,
          reviewIdempotencyKey: reviewKey,
        });
      if (reused && reused.id !== decision.id) {
        throw new ConflictException(
          'Review idempotency key was reused for another resource.',
        );
      }
      if (decision.reviewIdempotencyKey) {
        if (
          decision.reviewIdempotencyKey !== reviewKey ||
          decision.reviewIntentHash !== intentHash ||
          !decision.reviewResponseSnapshot
        ) {
          throw new ConflictException('Review retry intent changed.');
        }
        const replayConversation = await manager
          .getRepository(InboxConversationEntity)
          .findOneBy({
            id: conversationId,
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId!,
          });
        if (
          !replayConversation ||
          replayConversation.ownershipVersion !==
            decision.reviewResponseSnapshot.resultingOwnershipVersion
        ) {
          throw new ConflictException('Review ownership changed after apply.');
        }
        return publicReviewSnapshot(
          decision.reviewResponseSnapshot,
          'replayed',
        );
      }
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
      )
        return decision;
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

      if (approve && approvalKind === 'actions' && expectedVersion) {
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
        const tags = opportunity
          ? await manager.query<Array<{ slug: string }>>(
              `SELECT tag.slug
                 FROM crm_opportunity_tags link
                 JOIN crm_tags tag ON tag.id = link.tag_id
                  AND tag.tenant_id = link.tenant_id
                  AND tag.workspace_id = link.workspace_id
                WHERE link.tenant_id = $1 AND link.workspace_id = $2
                  AND link.opportunity_id = $3 AND tag.deleted_at IS NULL
                ORDER BY tag.slug`,
              [conversation.tenantId, conversation.workspaceId, opportunity.id],
            )
          : [];
        const actualVersion = previewVersion(
          decision.id,
          decision.ownershipVersion,
          canonicalOpportunityState(
            opportunity,
            tags.map((item) => item.slug),
            conversation.ownershipState,
          ),
        );
        if (actualVersion !== expectedVersion) {
          throw new ConflictException(
            'Decision preview is stale and must be refreshed.',
          );
        }
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
      decision.reviewIdempotencyKey = reviewKey;
      decision.reviewIntentHash = intentHash;
      decision.reviewExpectedVersion = expectedVersion ?? null;
      decision.reviewAuditRef = randomUUID();
      decision.reviewResponseSnapshot = {
        status: 'applied',
        outcome: decision.reviewOutcome,
        appliedActionIds: [...decision.reviewedActionKeys],
        originalAppliedAt: (
          decision.appliedAt ?? decision.reviewedAt
        ).toISOString(),
        auditRef: decision.reviewAuditRef,
        resultingOwnershipVersion: conversation.ownershipVersion,
      };
      const saved = await manager
        .getRepository(InboxAgentDecisionEntity)
        .save(decision);
      await manager.getRepository(InboxConversationEventEntity).save({
        id: saved.reviewAuditRef!,
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
      return publicReviewSnapshot(saved.reviewResponseSnapshot!, 'applied');
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
    for (const [actionIndex, action] of actions.entries()) {
      const type = action.type;
      if (
        type === 'set_stage' &&
        opportunity &&
        typeof action.stageId === 'string'
      ) {
        const proposedOpportunityId = recordString(action.opportunityId);
        const proposedFromStageId = recordString(action.fromStageId);
        if (
          proposedOpportunityId !== opportunity.id ||
          proposedFromStageId !== opportunity.stageId
        ) {
          throw new ConflictException({
            code: 'CRM_STAGE_TRANSITION_STALE',
            reasonCode: 'stage_transition_proposal_stale',
            message:
              'The reviewed stage proposal no longer matches the canonical opportunity.',
          });
        }
        if (this.opportunityCommands) {
          const moved =
            await this.opportunityCommands.moveStageWithinTransaction(
              manager,
              ctx,
              opportunity.id,
              action.stageId,
              {
                actor: { type: 'user', userId: ctx.userId ?? null },
                expectedTransitionPolicyId:
                  recordString(action.transitionPolicyId) || undefined,
                expectedTransitionPolicyVersion: Number.isInteger(
                  Number(action.transitionPolicyVersion),
                )
                  ? Number(action.transitionPolicyVersion)
                  : undefined,
                idempotencyKey: `review:${decision.id}:stage:${actionIndex}`,
                correlationId: decision.id,
                causationId: decision.id,
                reason:
                  recordString(action.reasonCode) || 'approved_agent_decision',
                metadata: { reviewDecisionId: decision.id },
              },
            );
          Object.assign(opportunity, moved.opportunity);
        } else {
          throw new Error('CRM opportunity command authority unavailable.');
        }
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
          if (action.value === 'lost') {
            if (!this.opportunityCommands) {
              throw new Error('CRM opportunity command authority unavailable.');
            }
            const changed =
              await this.opportunityCommands.changeStatusWithinTransaction(
                manager,
                ctx,
                opportunity.id,
                'lost',
                action.value,
                {
                  actor: { type: 'user', userId: ctx.userId ?? null },
                  idempotencyKey: `review:${decision.id}:status:${actionIndex}`,
                  correlationId: decision.id,
                  causationId: decision.id,
                  reason: 'approved_agent_decision',
                },
              );
            Object.assign(opportunity, changed);
          }
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
    if (opportunity) {
      if (this.opportunityCommands) {
        await this.opportunityCommands.updateWithinTransaction(
          manager,
          ctx,
          opportunity,
          {
            actor: { type: 'user', userId: ctx.userId ?? null },
            idempotencyKey: `review:${decision.id}:opportunity`,
            correlationId: decision.id,
            causationId: decision.id,
            reason: 'approved_agent_decision',
          },
        );
      } else {
        await manager.getRepository(CrmOpportunityEntity).save(opportunity);
      }
    }
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

function isGovernedActionType(
  value: unknown,
): value is InboxGovernedActionType {
  return [
    'reply',
    'ensure_contact',
    'ensure_opportunity',
    'set_stage',
    'add_tag',
    'set_summary',
    'set_service',
    'set_urgency',
    'set_fact',
    'close',
    'handoff',
  ].includes(String(value));
}

function canonicalStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function detectsPromptInjection(value: string): boolean {
  return /(ignore|ignorem|desconsidere|revele|mostre|substitua|sobrescreva).{0,40}(instru[cç][oõ]es|prompt|policy|regras|sistema)|system\s*prompt|developer\s*message/i.test(
    value,
  );
}

function detectsSensitiveTopic(value: string): boolean {
  return /(reclama[cç][aã]o|procon|processo|advogad|jur[ií]dic|privacidade|lgpd|vazamento|cobran[cç]a|estorno|fraude|amea[cç]a|imprensa)/i.test(
    value,
  );
}

export function factualReplyIsSupported(
  reply: string,
  contextText: string,
): boolean {
  const urls = reply.match(/https?:\/\/[^\s)]+/gi) ?? [];
  if (urls.some((url) => !contextText.includes(url.toLowerCase())))
    return false;
  const normalizedReply = normalizeFactualText(reply);
  const normalizedContext = normalizeFactualText(contextText);
  const exactClaims = [
    ...normalizedReply.matchAll(/r\$\s*\d+(?:[.,]\d{2})?/g),
    ...normalizedReply.matchAll(/\b\d{1,2}h(?:\d{2})?\b/g),
    ...normalizedReply.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g),
  ].map((match) => match[0]);
  if (exactClaims.some((claim) => !normalizedContext.includes(claim)))
    return false;
  if (
    /\b(desconto|garantia|contrato|politica|pix|parcel(?:a|ado|amento)?)\b/.test(
      normalizedReply,
    ) &&
    !/\b(desconto|garantia|contrato|politica|pix|parcel(?:a|ado|amento)?)\b/.test(
      normalizedContext,
    )
  )
    return false;
  if (
    /\b(oferecemos|trabalhamos|temos|fazemos|atendemos|somos|garantimos|nosso(?:s|a|as)?)\b/i.test(
      reply,
    ) &&
    factualTokenSupport(normalizedReply, normalizedContext) < 0.35
  )
    return false;
  return /\?|\b(entendi|certo|perfeito|obrigad[oa]|ol[aá]|oi|posso|vou transferir)\b/i.test(
    reply,
  );
}

function normalizeFactualText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function factualTokenSupport(reply: string, context: string): number {
  const ignored = new Set([
    'aqui',
    'como',
    'com',
    'isso',
    'mais',
    'para',
    'pela',
    'pelo',
    'podemos',
    'pode',
    'que',
    'seu',
    'sua',
    'tambem',
    'uma',
    'voce',
  ]);
  const tokens = [
    ...new Set(
      (reply.match(/[a-z0-9]{4,}/g) ?? []).filter(
        (token) => !ignored.has(token),
      ),
    ),
  ];
  if (tokens.length === 0) return 0;
  return (
    tokens.filter((token) => context.includes(token)).length / tokens.length
  );
}

function stableLowercase(value: unknown): string {
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return '';
  }
}

type CanonicalOpportunityState = {
  opportunityId: string | null;
  pipelineId: string | null;
  stageId: string | null;
  tags: string[];
  agentSummary: string | null;
  service: string | null;
  urgency: string | null;
  priority: string | null;
  closeReason: string | null;
  status: string | null;
  updatedAt: string | null;
  rowVersion: number | null;
  ownershipState: string;
};

function canonicalOpportunityState(
  opportunity: CrmOpportunityEntity | null,
  tags: string[],
  ownershipState: string,
): CanonicalOpportunityState {
  const context = opportunity?.businessContext ?? {};
  return {
    opportunityId: opportunity?.id ?? null,
    pipelineId: opportunity?.pipelineId ?? null,
    stageId: opportunity?.stageId ?? null,
    tags: [...tags].sort(),
    agentSummary:
      typeof context.agentSummary === 'string' ? context.agentSummary : null,
    service: typeof context.service === 'string' ? context.service : null,
    urgency: typeof context.urgency === 'string' ? context.urgency : null,
    priority: opportunity?.priority ?? null,
    closeReason: opportunity?.lostReason ?? null,
    status: opportunity?.status ?? null,
    updatedAt: opportunity?.updatedAt?.toISOString() ?? null,
    rowVersion: opportunity?.rowVersion ?? null,
    ownershipState,
  };
}

function previewVersion(
  decisionId: string,
  ownershipVersion: number,
  state: CanonicalOpportunityState,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ decisionId, ownershipVersion, state }))
    .digest('hex');
}

function currentValueForAction(
  type: string,
  current: CanonicalOpportunityState,
): string | string[] | null {
  if (type === 'set_stage') return current.stageId;
  if (type === 'add_tag') return current.tags;
  if (type === 'set_summary') return current.agentSummary;
  if (type === 'set_service') return current.service;
  if (type === 'set_urgency') return current.urgency ?? current.priority;
  if (type === 'close') return current.status;
  if (type === 'handoff') return current.ownershipState;
  return null;
}

function publicReviewSnapshot(
  snapshot: Record<string, unknown>,
  status: 'applied' | 'replayed',
) {
  return {
    status,
    outcome: snapshot.outcome ?? null,
    appliedActionIds: Array.isArray(snapshot.appliedActionIds)
      ? snapshot.appliedActionIds
      : [],
    originalAppliedAt:
      typeof snapshot.originalAppliedAt === 'string'
        ? snapshot.originalAppliedAt
        : null,
    auditRef: typeof snapshot.auditRef === 'string' ? snapshot.auditRef : null,
  };
}
