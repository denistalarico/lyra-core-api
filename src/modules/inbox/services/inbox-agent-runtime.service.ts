import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities/leadflow-agent.entity';
import { LeadFlowAgentChannelBindingEntity } from '../../leadflow-agents/entities/leadflow-agent-channel-binding.entity';
import { InboxAgentDecisionEntity } from '../entities/inbox-agent-decision.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxMediaAssetEntity } from '../entities/inbox-media-asset.entity';
import { InboxMediaDerivativeEntity } from '../entities/inbox-media-derivative.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { InboxProcessingBatchEntity } from '../entities/inbox-processing-batch.entity';

export type AgentDecisionProposal = {
  reply: string | null;
  follow_text: string | null;
  stage_name: string | null;
  tags: string[];
  handoff: boolean;
  handoff_reason: string | null;
  agent_summary: string;
  service: string | null;
  urgency: 'low' | 'normal' | 'high' | 'urgent';
  close_reason: string | null;
};

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
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async claimAndProcess(workerId: string) {
    const batchId = await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT id FROM inbox_processing_batches WHERE status = 'pending' AND due_at <= now()
         ORDER BY due_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
      )) as unknown as Array<{ id: string }>;
      if (!rows[0]) return null;
      await manager
        .getRepository(InboxProcessingBatchEntity)
        .update(rows[0].id, {
          status: 'processing',
          claimedAt: new Date(),
          claimedBy: workerId,
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
    if (
      !conversation ||
      conversation.ownershipState !== 'ai_active' ||
      !conversation.aiEnabled
    ) {
      await this.dataSource
        .getRepository(InboxProcessingBatchEntity)
        .update(batch.id, {
          status: 'cancelled',
          errorCode: 'ai_not_owner',
          completedAt: new Date(),
        });
      return null;
    }
    const messages = await this.dataSource
      .getRepository(InboxMessageEntity)
      .createQueryBuilder('message')
      .where(
        'message.tenant_id = :tenantId AND message.workspace_id = :workspaceId AND message.conversation_id = :conversationId',
        batch,
      )
      .orderBy('message.occurred_at', 'ASC')
      .addOrderBy('message.provider_sequence', 'ASC', 'NULLS LAST')
      .addOrderBy('message.id', 'ASC')
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
    const context = {
      conversationId: conversation.id,
      contactId: conversation.contactId,
      opportunityId: opportunity?.id ?? conversation.opportunityId,
      businessMode: conversation.businessMode,
      messages: orderedMessages.map((message) => ({
        id: message.id,
        direction: message.direction,
        type: message.messageType,
        content: message.content.slice(0, 2000),
        occurredAt: message.occurredAt.toISOString(),
      })),
      media: media.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        status: asset.status,
        derivative:
          derivatives.find((item) => item.mediaAssetId === asset.id)?.status ??
          null,
        derivedContent:
          derivatives
            .find(
              (item) =>
                item.mediaAssetId === asset.id && item.status === 'available',
            )
            ?.content?.slice(0, 3000) ?? null,
      })),
    };
    const proposal = this.buildSupervisedProposal(
      orderedMessages,
      media,
      derivatives,
    );
    this.assertValidProposal(proposal);
    const decision = await this.dataSource
      .getRepository(InboxAgentDecisionEntity)
      .save({
        tenantId: batch.tenantId,
        workspaceId: batch.workspaceId,
        conversationId: batch.conversationId,
        batchId: batch.id,
        agentId: agent?.id ?? conversation.assignedAgentId,
        agentVersionId: agent?.publishedVersionId ?? null,
        ownershipVersion: conversation.ownershipVersion,
        schemaVersion: 1,
        idempotencyKey: `batch:${batch.id}:decision:v1`,
        correlationId: randomUUID(),
        status: 'proposed',
        proposal,
        policyResult: {
          mode: 'supervised',
          automaticEffectsAllowed: false,
          mediaContext: this.mediaPolicy(media, derivatives),
        },
        contextSnapshot: context,
        errorCode: null,
        reviewedBy: null,
        reviewedAt: null,
      });
    batch.status = 'completed';
    batch.completedAt = new Date();
    batch.errorCode = null;
    await this.dataSource.getRepository(InboxProcessingBatchEntity).save(batch);
    return decision;
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
  async review(
    ctx: RequestContext,
    conversationId: string,
    decisionId: string,
    approve: boolean,
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
        decision.status = 'invalidated';
        decision.errorCode = 'ownership_changed';
      } else {
        decision.status = approve ? 'approved' : 'rejected';
      }
      decision.reviewedBy = reviewerUserId;
      decision.reviewedAt = new Date();
      return manager.getRepository(InboxAgentDecisionEntity).save(decision);
    });
  }

  assertValidProposal(value: unknown): asserts value is AgentDecisionProposal {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('invalid_agent_decision_schema');
    const item = value as Record<string, unknown>;
    const required = [
      'reply',
      'follow_text',
      'stage_name',
      'tags',
      'handoff',
      'handoff_reason',
      'agent_summary',
      'service',
      'urgency',
      'close_reason',
    ];
    if (
      !required.every((key) => key in item) ||
      !Array.isArray(item.tags) ||
      typeof item.handoff !== 'boolean' ||
      typeof item.agent_summary !== 'string' ||
      !['low', 'normal', 'high', 'urgent'].includes(String(item.urgency))
    ) {
      throw new Error('invalid_agent_decision_schema');
    }
  }
  private buildSupervisedProposal(
    messages: InboxMessageEntity[],
    media: InboxMediaAssetEntity[],
    derivatives: InboxMediaDerivativeEntity[],
  ): AgentDecisionProposal {
    const inbound = messages.filter(
      (message) => message.direction === 'inbound',
    );
    const latest = inbound.at(-1)?.content ?? '';
    const mediaPolicy = this.mediaPolicy(media, derivatives);
    return {
      reply:
        'Olá! Obrigado pela mensagem. Vou analisar as informações e já continuo por aqui.',
      follow_text: null,
      stage_name: null,
      tags: [],
      handoff: false,
      handoff_reason: null,
      agent_summary: latest.slice(0, 500),
      service: null,
      urgency: 'normal',
      close_reason: null,
      ...(mediaPolicy === 'blocked'
        ? {
            reply: null,
            handoff: true,
            handoff_reason: 'media_derivative_unavailable',
          }
        : {}),
    };
  }
  private mediaPolicy(
    media: InboxMediaAssetEntity[],
    derivatives: InboxMediaDerivativeEntity[],
  ) {
    const needed = media.filter(
      (item) => item.kind === 'audio' || item.kind === 'image',
    );
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
        '(binding.external_ref = :channelId OR binding.channel_key = :channelKey)',
        {
          channelId: batch.channelId,
          channelKey: 'whatsapp',
        },
      );
    if (conversation.assignedAgentId) {
      qb.orderBy(
        'CASE WHEN agent.id = :assignedAgentId THEN 0 ELSE 1 END',
        'ASC',
      ).setParameter('assignedAgentId', conversation.assignedAgentId);
    }
    return qb.addOrderBy('agent.updated_at', 'DESC').getOne();
  }
}
