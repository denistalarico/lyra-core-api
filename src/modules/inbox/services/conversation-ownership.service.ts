import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  AgencyWorkspaceUserEntity as WorkspaceUserEntity,
  AgencyUserProfileEntity as UserProfileEntity,
} from '../../agency/entities/agency-settings.entities';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities/leadflow-agent.entity';
import { InboxAgentDecisionEntity } from '../entities/inbox-agent-decision.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import {
  InboxConversationEntity,
  InboxConversationOwnershipState,
} from '../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../entities/inbox-conversation-event.entity';
import { recordQualificationTransition } from './qualification-transition.recorder';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxProcessingBatchEntity } from '../entities/inbox-processing-batch.entity';
import { InboxNotificationPublisher } from './inbox-notification.publisher';
import { InboxHandoffWhatsAppNotifier } from './inbox-handoff-whatsapp.notifier';
import { hasLeadFlowOutboundOptOut } from './leadflow-contact-opt-out';

export type ConversationOwnershipAction =
  | 'request_handoff'
  | 'assume'
  | 'pause'
  | 'return_ai'
  | 'close';

export type HandoffOpportunityTransfer = {
  pipelineId: string | null;
  stageId: string | null;
  idempotencyKey: string;
  agentId?: string | null;
};

@Injectable()
export class ConversationOwnershipService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    @Optional()
    private readonly notificationPublisher?: InboxNotificationPublisher,
    @Optional()
    private readonly opportunityCommands?: CrmOpportunityCommandService,
    @Optional()
    private readonly whatsAppNotifier?: InboxHandoffWhatsAppNotifier,
  ) {}

  async requestHandoff(
    ctx: RequestContext,
    conversationId: string,
    reason?: string,
    transfer?: HandoffOpportunityTransfer,
  ): Promise<InboxConversationEntity> {
    const conversation = await this.transition(
      ctx,
      conversationId,
      'request_handoff',
      reason,
    );
    if (!transfer) return conversation;

    try {
      if (!transfer.pipelineId || !transfer.stageId) {
        throw new Error('handoff_transfer_configuration_invalid');
      }
      if (!this.opportunityCommands) {
        throw new Error('crm_command_authority_unavailable');
      }
      const opportunity = conversation.opportunityId
        ? await this.dataSource.getRepository(CrmOpportunityEntity).findOneBy({
            id: conversation.opportunityId,
            tenantId: conversation.tenantId,
            workspaceId: conversation.workspaceId,
          })
        : await this.dataSource.getRepository(CrmOpportunityEntity).findOne({
            where: {
              inboxConversationId: conversation.id,
              tenantId: conversation.tenantId,
              workspaceId: conversation.workspaceId,
              status: 'open',
            },
            order: { createdAt: 'DESC' },
          });
      if (!opportunity) throw new Error('handoff_opportunity_missing');
      const result = await this.opportunityCommands.transferPipeline(
        ctx,
        opportunity.id,
        transfer.pipelineId,
        transfer.stageId,
        {
          actor: transfer.agentId
            ? { type: 'ai', agentId: transfer.agentId }
            : { type: 'system' },
          expectedVersion: opportunity.rowVersion,
          idempotencyKey: transfer.idempotencyKey,
          correlationId: conversation.id,
          causationId: conversation.id,
          reason: 'handoff_pipeline_transfer',
          transferMode: 'handoff',
          metadata: {
            conversationId: conversation.id,
            ownershipVersion: conversation.ownershipVersion,
          },
        },
      );
      return this.recordHandoffTransferOutcome(
        ctx,
        conversation,
        transfer,
        'completed',
        null,
        result.opportunity.id,
      );
    } catch (error) {
      return this.recordHandoffTransferOutcome(
        ctx,
        conversation,
        transfer,
        'failed',
        ownershipErrorCode(error),
        conversation.opportunityId,
      );
    }
  }

  async transition(
    ctx: RequestContext,
    conversationId: string,
    action: ConversationOwnershipAction,
    reason?: string,
  ) {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    if (
      (action === 'assume' ||
        action === 'return_ai' ||
        action === 'pause' ||
        action === 'close') &&
      !ctx.userId
    ) {
      throw new BadRequestException('User context is required.');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const conversation = await manager
        .getRepository(InboxConversationEntity)
        .findOne({
          where: {
            id: conversationId,
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!conversation)
        throw new NotFoundException('Inbox conversation not found.');
      await this.assertManagedContext(manager, ctx, conversation);

      if (
        action === 'request_handoff' &&
        conversation.ownershipState === 'handoff_requested'
      ) {
        return {
          conversation,
          handoffRecipientUserIds: [] as string[],
          channelClientId: null as string | null,
          publishHandoffNotification: false,
        };
      }

      if (
        action === 'assume' &&
        conversation.ownershipState === 'human_active'
      ) {
        if (conversation.assignedUserId === ctx.userId) {
          return {
            conversation,
            handoffRecipientUserIds: [] as string[],
            channelClientId: null as string | null,
            publishHandoffNotification: false,
          };
        }
        // Sem responsável (ex.: atribuição removida) a conversa está livre —
        // qualquer operador pode assumir sem conflito.
        if (conversation.assignedUserId) {
          throw new ConflictException(
            'Conversation is already owned by another user.',
          );
        }
      }
      if (
        action === 'return_ai' &&
        (conversation.qualificationStatus === 'internal' ||
          hasLeadFlowOutboundOptOut(conversation))
      ) {
        throw new ConflictException(
          'This conversation is not eligible for automatic replies.',
        );
      }

      // A human activation is an explicit qualification signal. This also
      // unlocks conversations created before Instagram became a lead-eligible
      // channel, while the internal-contact and opt-out guards above remain
      // authoritative.
      if (
        action === 'return_ai' &&
        conversation.qualificationStatus !== 'qualified'
      ) {
        const previousQualification = conversation.qualificationStatus;
        conversation.qualificationStatus = 'qualified';
        conversation.qualificationReason = 'manual_ai_activation';
        await recordQualificationTransition(manager, {
          conversation,
          previousStatus: previousQualification,
          newStatus: 'qualified',
          reason: 'manual_ai_activation',
          actor: { type: 'user', userId: ctx.userId ?? null },
          occurredAt: new Date(),
        });
      }

      const previousVersion = conversation.ownershipVersion;
      const next = this.resolveTransition(action);
      conversation.ownershipState = next;
      conversation.ownershipVersion += 1;
      conversation.ownershipReason = reason?.trim().slice(0, 180) || action;
      conversation.ownershipChangedAt = new Date();
      conversation.aiEnabled = next === 'ai_active';
      if (next === 'human_active') {
        conversation.assignedUserId = ctx.userId!;
        conversation.assignedAgentId = null;
        // Guardamos nome/avatar de quem assumiu: listForwardTargets exclui o
        // próprio usuário, então sem isto a UI só conseguiria mostrar iniciais.
        const [workspaceUser, profile] = await Promise.all([
          manager.getRepository(WorkspaceUserEntity).findOne({
            where: {
              tenantId: ctx.tenantId,
              workspaceId: ctx.workspaceId,
              userId: ctx.userId!,
            },
          }),
          manager
            .getRepository(UserProfileEntity)
            .findOne({ where: { userId: ctx.userId! } }),
        ]);
        conversation.metadata = {
          ...(conversation.metadata ?? {}),
          assignedUserSnapshot: {
            userId: ctx.userId,
            name: workspaceUser?.name ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
          },
        };
        if (
          conversation.status === 'new' ||
          conversation.status === 'handoff_requested'
        )
          conversation.status = 'open';
      } else if (next === 'handoff_requested') {
        conversation.status = 'handoff_requested';
      } else if (next === 'closed') {
        conversation.status = 'closed';
        conversation.closedAt = new Date();
      } else if (next === 'ai_active') {
        conversation.assignedUserId = null;
        if (conversation.status === 'handoff_requested')
          conversation.status = 'open';
      }
      const saved = await manager
        .getRepository(InboxConversationEntity)
        .save(conversation);

      if (next !== 'ai_active') await this.invalidateAutomation(manager, saved);
      await this.audit(manager, ctx, saved, action, previousVersion);
      await this.projectOpportunity(manager, saved);
      const handoffRoute =
        next === 'handoff_requested'
          ? await this.resolveHandoffNotificationRoute(manager, saved)
          : {
              recipientUserIds: [] as string[],
              clientId: null as string | null,
            };
      return {
        conversation: saved,
        handoffRecipientUserIds: handoffRoute.recipientUserIds,
        channelClientId: handoffRoute.clientId,
        publishHandoffNotification: next === 'handoff_requested',
      };
    });
    if (result.publishHandoffNotification) {
      // Canonical order: the in-app notification (persisted + realtime) first,
      // then the additional, fully isolated WhatsApp attempt. The latter never
      // affects the handoff or the in-app notification.
      await this.notificationPublisher?.publishHandoffRequested({
        conversation: result.conversation,
        recipientUserIds: result.handoffRecipientUserIds,
        clientId: result.channelClientId,
      });
      await this.whatsAppNotifier?.notifyHandoff({
        conversation: result.conversation,
        recipientUserIds: result.handoffRecipientUserIds,
      });
    }
    return result.conversation;
  }

  async assertAiCanSend(input: {
    tenantId: string;
    workspaceId: string;
    conversationId: string;
    ownershipVersion: number;
  }) {
    const conversation = await this.dataSource
      .getRepository(InboxConversationEntity)
      .findOneBy(input);
    if (
      !conversation ||
      conversation.ownershipState !== 'ai_active' ||
      !conversation.aiEnabled
    ) {
      throw new ConflictException(
        'AI send blocked by current conversation ownership.',
      );
    }
    return conversation;
  }

  private resolveTransition(
    action: ConversationOwnershipAction,
  ): InboxConversationOwnershipState {
    return (
      {
        request_handoff: 'handoff_requested',
        assume: 'human_active',
        pause: 'paused',
        return_ai: 'ai_active',
        close: 'closed',
      } as const
    )[action];
  }
  private async assertManagedContext(
    manager: EntityManager,
    ctx: RequestContext,
    conversation: InboxConversationEntity,
  ) {
    if (ctx.managedContext?.operatingMode !== 'client') return;
    if (!conversation.channelId)
      throw new NotFoundException('Inbox conversation not found.');
    const channel = await manager.getRepository(InboxChannelEntity).findOneBy({
      id: conversation.channelId,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId!,
    });
    if (
      !channel ||
      channel.metadata?.clientId !== ctx.managedContext.clientId
    ) {
      throw new NotFoundException('Inbox conversation not found.');
    }
  }
  private async invalidateAutomation(
    manager: EntityManager,
    conversation: InboxConversationEntity,
  ) {
    await manager
      .createQueryBuilder()
      .update(InboxAgentDecisionEntity)
      .set({ status: 'invalidated', errorCode: 'ownership_changed' })
      .where(
        'tenant_id = :tenantId AND workspace_id = :workspaceId AND conversation_id = :conversationId AND status = :status',
        {
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          status: 'proposed',
        },
      )
      .execute();
    await manager
      .createQueryBuilder()
      .update(InboxProcessingBatchEntity)
      .set({
        status: 'cancelled',
        errorCode: 'ownership_changed',
        completedAt: new Date(),
      })
      .where(
        "tenant_id = :tenantId AND workspace_id = :workspaceId AND conversation_id = :conversationId AND status IN ('pending','processing')",
        {
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
        },
      )
      .execute();
  }
  private async audit(
    manager: EntityManager,
    ctx: RequestContext,
    conversation: InboxConversationEntity,
    action: string,
    previousVersion: number,
  ) {
    await manager.getRepository(InboxConversationEventEntity).save({
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      eventType: `ownership_${action}`,
      actorType: ctx.userId ? 'user' : 'system',
      actorUserId: ctx.userId ?? null,
      payload: {
        ownershipState: conversation.ownershipState,
        previousVersion,
        ownershipVersion: conversation.ownershipVersion,
      },
    });
    await manager.getRepository(InboxDomainOutboxEntity).save({
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
      aggregateType: 'inbox_conversation',
      aggregateId: conversation.id,
      eventName:
        action === 'assume'
          ? 'leadflow.inbox.conversation.handoff.accepted'
          : action === 'request_handoff'
            ? 'leadflow.inbox.conversation.handoff.requested'
            : action === 'close'
              ? 'leadflow.inbox.conversation.closed'
              : 'leadflow.inbox.conversation.updated',
      eventVersion: 1,
      idempotencyKey: `ownership:${conversation.id}:${conversation.ownershipVersion}`,
      payload: {
        conversationId: conversation.id,
        ownershipState: conversation.ownershipState,
        ownershipVersion: conversation.ownershipVersion,
      },
      publishedAt: null,
    });
  }
  private async projectOpportunity(
    manager: EntityManager,
    conversation: InboxConversationEntity,
  ) {
    // Handoff (and a human already active) both block the follow-up timer
    // consumer from sending — `isHandoff` in the LeadFlow followup consumer
    // checks the very same two states. What it does not do is retract the
    // "próximo follow" the card already shows: the armed timer only notices
    // the handoff at its own fire instant, which can be hours away. Clearing
    // it here, in the same transaction as the ownership change, is what makes
    // the card stop claiming a follow-up that will not go out.
    const stopsFollowUp =
      conversation.ownershipState === 'handoff_requested' ||
      conversation.ownershipState === 'human_active';
    await manager
      .createQueryBuilder()
      .update(CrmOpportunityEntity)
      .set({
        operationalStatus: conversation.ownershipState,
        assignedUserId:
          conversation.ownershipState === 'human_active'
            ? conversation.assignedUserId
            : undefined,
        nextFollowUpAt: stopsFollowUp ? null : undefined,
        metadata: () =>
          `COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('inboxOwnershipVersion', ${conversation.ownershipVersion})`,
      })
      .where(
        '(id = :id OR inbox_conversation_id = :conversationId) AND tenant_id = :tenantId AND workspace_id = :workspaceId',
        {
          id: conversation.opportunityId,
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
        },
      )
      .execute();
  }

  private async resolveHandoffNotificationRoute(
    manager: EntityManager,
    conversation: InboxConversationEntity,
  ) {
    const channel = conversation.channelId
      ? await manager.getRepository(InboxChannelEntity).findOneBy({
          id: conversation.channelId,
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
        })
      : null;
    // O destino do handoff é configuração do agente que atendia: um SDR
    // entrega ao comercial, uma recepção entrega à secretária. Só depois disso
    // valem os fallbacks genéricos (responsável da conversa, do canal, owners).
    const configuredRecipients = await this.resolveAgentHandoffRecipients(
      manager,
      conversation,
    );
    const directRecipient = configuredRecipients.length
      ? null
      : (conversation.assignedUserId ?? channel?.defaultAssignedUserId ?? null);
    const owners =
      configuredRecipients.length || directRecipient
        ? []
        : await manager.getRepository(WorkspaceUserEntity).find({
            where: {
              tenantId: conversation.tenantId,
              workspaceId: conversation.workspaceId,
              role: 'owner',
              status: 'active',
            },
          });
    const clientId =
      typeof channel?.metadata?.clientId === 'string'
        ? channel.metadata.clientId
        : null;

    return {
      recipientUserIds: configuredRecipients.length
        ? configuredRecipients
        : directRecipient
          ? [directRecipient]
          : owners
              .map((owner) => owner.userId)
              .filter((userId): userId is string => Boolean(userId)),
      clientId,
    };
  }

  /**
   * Os usuários que o agente da conversa designou para receber o handoff.
   *
   * Cada id é confirmado contra um usuário ativo do mesmo workspace: uma
   * configuração antiga apontando para alguém que saiu da equipe não pode
   * engolir a notificação — nesse caso a lista volta vazia e a rota herdada
   * assume.
   */
  private async resolveAgentHandoffRecipients(
    manager: EntityManager,
    conversation: InboxConversationEntity,
  ): Promise<string[]> {
    if (!conversation.assignedAgentId) return [];

    const agent = await manager.getRepository(LeadFlowAgentEntity).findOneBy({
      id: conversation.assignedAgentId,
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
    });
    const configured = agent?.handoffPolicy?.targetUserIds;
    if (!Array.isArray(configured) || configured.length === 0) return [];

    const requested = [
      ...new Set(
        configured.filter(
          (userId): userId is string =>
            typeof userId === 'string' && userId.trim() !== '',
        ),
      ),
    ];
    if (requested.length === 0) return [];

    const members = await manager.getRepository(WorkspaceUserEntity).find({
      where: requested.map((userId) => ({
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        userId,
        status: 'active',
      })),
    });

    return members
      .map((member) => member.userId)
      .filter((userId): userId is string => Boolean(userId));
  }

  private async recordHandoffTransferOutcome(
    ctx: RequestContext,
    snapshot: InboxConversationEntity,
    transfer: HandoffOpportunityTransfer,
    status: 'completed' | 'failed',
    errorCode: string | null,
    opportunityId: string | null,
  ): Promise<InboxConversationEntity> {
    return this.dataSource.transaction(async (manager) => {
      const conversation = await manager
        .getRepository(InboxConversationEntity)
        .findOne({
          where: {
            id: snapshot.id,
            tenantId: snapshot.tenantId,
            workspaceId: snapshot.workspaceId,
          },
          lock: { mode: 'pessimistic_write' },
        });
      if (!conversation)
        throw new NotFoundException('Inbox conversation not found.');
      const previous = conversation.metadata?.handoffTransfer;
      if (
        previous &&
        typeof previous === 'object' &&
        !Array.isArray(previous) &&
        (previous as Record<string, unknown>).idempotencyKey ===
          transfer.idempotencyKey &&
        (previous as Record<string, unknown>).status === status
      ) {
        return conversation;
      }
      conversation.metadata = {
        ...(conversation.metadata ?? {}),
        handoffTransfer: {
          status,
          errorCode,
          opportunityId,
          pipelineId: transfer.pipelineId,
          stageId: transfer.stageId,
          idempotencyKey: transfer.idempotencyKey,
          occurredAt: new Date().toISOString(),
        },
      };
      const saved = await manager
        .getRepository(InboxConversationEntity)
        .save(conversation);
      await manager.getRepository(InboxConversationEventEntity).save({
        tenantId: saved.tenantId,
        workspaceId: saved.workspaceId,
        conversationId: saved.id,
        eventType: `handoff_transfer_${status}`,
        actorType: ctx.userId ? 'user' : 'system',
        actorUserId: ctx.userId ?? null,
        payload: {
          opportunityId,
          pipelineId: transfer.pipelineId,
          stageId: transfer.stageId,
          errorCode,
          ownershipState: saved.ownershipState,
          ownershipVersion: saved.ownershipVersion,
        },
      });
      await manager.getRepository(InboxDomainOutboxEntity).save({
        tenantId: saved.tenantId,
        workspaceId: saved.workspaceId,
        aggregateType: 'inbox_conversation',
        aggregateId: saved.id,
        eventName: `leadflow.inbox.conversation.handoff.transfer.${status}`,
        eventVersion: 1,
        idempotencyKey: `handoff-transfer:${transfer.idempotencyKey}:${status}`,
        payload: {
          conversationId: saved.id,
          opportunityId,
          pipelineId: transfer.pipelineId,
          stageId: transfer.stageId,
          errorCode,
          ownershipState: saved.ownershipState,
          ownershipVersion: saved.ownershipVersion,
        },
        publishedAt: null,
      });
      return saved;
    });
  }
}

function ownershipErrorCode(error: unknown): string {
  const response =
    error && typeof error === 'object'
      ? (error as { response?: unknown }).response
      : null;
  const responseReason =
    response && typeof response === 'object'
      ? (response as Record<string, unknown>).reasonCode
      : null;
  const value =
    typeof responseReason === 'string'
      ? responseReason
      : error instanceof Error
        ? error.message
        : 'handoff_transfer_failed';
  return /^[a-z0-9_]{1,80}$/.test(value) ? value : 'handoff_transfer_failed';
}
