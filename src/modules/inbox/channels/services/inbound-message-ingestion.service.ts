import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ContactEntity } from '../../../contacts/entities/contact.entity';
import { ContactMethodEntity } from '../../../contacts/entities/contact-method.entity';
import { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../../entities/inbox-domain-outbox.entity';
import {
  InboxMediaAssetEntity,
  InboxMediaKind,
} from '../../entities/inbox-media-asset.entity';
import { InboxMessageEntity } from '../../entities/inbox-message.entity';
import { InboxProcessingBatchEntity } from '../../entities/inbox-processing-batch.entity';
import { InboxSettingsEntity } from '../../entities/inbox-settings.entity';
import { InboxNotificationPublisher } from '../../services/inbox-notification.publisher';
import type {
  NormalizedInboundAttachment,
  NormalizedInboundMessage,
} from '../types/normalized-inbound-message';
import { AgentActivationPolicyService } from '../../services/agent-activation-policy.service';

const DEFAULT_DEBOUNCE_SECONDS = 20;

@Injectable()
export class InboundMessageIngestionService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly notificationPublisher: InboxNotificationPublisher,
    private readonly activationPolicy?: AgentActivationPolicyService,
  ) {}

  async ingest(input: NormalizedInboundMessage) {
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [
          `${input.tenantId}:${input.workspaceId}:${input.channelId}:${input.externalThreadId}`,
        ],
      );

      if (input.externalMessageId) {
        const duplicate = await manager
          .getRepository(InboxMessageEntity)
          .findOne({
            where: {
              tenantId: input.tenantId,
              workspaceId: input.workspaceId,
              channelId: input.channelId,
              externalMessageId: input.externalMessageId,
            },
          });
        if (duplicate) {
          const conversation = await manager
            .getRepository(InboxConversationEntity)
            .findOneByOrFail({
              id: duplicate.conversationId,
              tenantId: input.tenantId,
              workspaceId: input.workspaceId,
            });
          return { conversation, message: duplicate, deduplicated: true };
        }
      }

      const occurredAt = input.occurredAt ?? new Date();
      const channel = await manager
        .getRepository(InboxChannelEntity)
        .findOneByOrFail({
          id: input.channelId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
        });
      const internalContact = await this.findInternalContact(manager, input);
      const qualification = internalContact
        ? { status: 'internal' as const, reason: 'workspace_internal_contact' }
        : await this.qualify(manager, input);

      let conversation = await manager
        .getRepository(InboxConversationEntity)
        .findOne({
          where: {
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            externalThreadId: input.externalThreadId,
          },
        });
      const activation = this.activationPolicy
        ? await this.activationPolicy.evaluate({
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            messageText: input.content,
            conversationState: conversation?.ownershipState,
            internalContact: Boolean(internalContact),
            duplicate: false,
            qualificationStatus: qualification.status,
            referralTrusted: input.metadata?.referralTrusted === true,
            referral:
              input.metadata?.referral &&
              typeof input.metadata.referral === 'object'
                ? (input.metadata.referral as Record<string, unknown>)
                : {},
          })
        : {
            wouldActivate:
              qualification.status === 'qualified' && channel.aiEnabled,
            policyVersion: 0,
            reasonCode: 'legacy_test_fallback',
            exclusions: [] as string[],
          };

      if (!conversation) {
        const aiActive =
          qualification.status === 'qualified' && activation.wouldActivate;
        conversation = manager.getRepository(InboxConversationEntity).create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          contactId: internalContact?.id ?? null,
          opportunityId: null,
          externalThreadId: input.externalThreadId,
          title: this.createConversationTitle(input),
          status: 'new',
          priority: 'normal',
          assignedUserId: null,
          assignedAgentId: aiActive ? channel.defaultAgentId : null,
          source: input.channelType,
          businessMode: 'general',
          lastMessagePreview: this.createPreview(input.content),
          lastMessageAt: occurredAt,
          unreadCount: 0,
          aiEnabled: aiActive,
          ownershipState: aiActive ? 'ai_active' : 'paused',
          ownershipVersion: 1,
          ownershipReason: qualification.reason,
          ownershipChangedAt: new Date(),
          qualificationStatus: qualification.status,
          qualificationReason: qualification.reason,
          closedAt: null,
          archivedAt: null,
          metadata: {
            provider: input.provider ?? null,
            channelType: input.channelType,
          },
        });
        conversation = await manager
          .getRepository(InboxConversationEntity)
          .save(conversation);
      } else if (internalContact) {
        conversation.contactId = internalContact.id;
        conversation.qualificationStatus = 'internal';
        conversation.qualificationReason = 'workspace_internal_contact';
        if (conversation.ownershipState === 'ai_active') {
          conversation.ownershipState = 'paused';
          conversation.ownershipVersion += 1;
          conversation.ownershipChangedAt = new Date();
        }
        conversation.aiEnabled = false;
      } else if (
        conversation.qualificationStatus !== 'qualified' &&
        qualification.status === 'qualified'
      ) {
        conversation.qualificationStatus = 'qualified';
        conversation.qualificationReason = qualification.reason;
        if (
          activation.wouldActivate &&
          conversation.ownershipState === 'paused'
        ) {
          conversation.ownershipState = 'ai_active';
          conversation.ownershipVersion += 1;
          conversation.ownershipChangedAt = new Date();
          conversation.aiEnabled = true;
          conversation.assignedAgentId = channel.defaultAgentId;
        }
      }

      const message = await manager.getRepository(InboxMessageEntity).save(
        manager.getRepository(InboxMessageEntity).create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          conversationId: conversation.id,
          channelId: input.channelId,
          contactId: conversation.contactId,
          direction: 'inbound',
          senderType: 'contact',
          senderUserId: null,
          senderAgentId: null,
          externalMessageId: input.externalMessageId ?? null,
          messageType: this.toPersistedMessageType(input.messageType),
          content: input.content,
          status: 'received',
          attachments: [],
          metadata: {
            provider: input.provider ?? null,
            channelType: input.channelType,
            senderExternalId: input.sender.externalId,
          },
          sentAt: occurredAt,
          deliveredAt: null,
          readAt: null,
          occurredAt,
          providerSequence: this.readProviderSequence(input.metadata),
        }),
      );

      const media = await this.createMediaAssets(
        manager,
        input,
        conversation,
        message,
      );
      if (media.length) {
        message.attachments = media.map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          mimeType: asset.mimeType,
          status: asset.status,
          name: asset.safeFilename,
        }));
        await manager.getRepository(InboxMessageEntity).save(message);
      }

      conversation.lastMessagePreview = this.createPreview(input.content);
      conversation.lastMessageAt = occurredAt;
      conversation.unreadCount = (conversation.unreadCount ?? 0) + 1;
      if (
        conversation.status === 'closed' ||
        conversation.status === 'archived'
      ) {
        conversation.status = 'new';
        conversation.closedAt = null;
        conversation.archivedAt = null;
      }
      await manager.getRepository(InboxConversationEntity).save(conversation);

      await manager.getRepository(InboxConversationEventEntity).save(
        manager.getRepository(InboxConversationEventEntity).create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          conversationId: conversation.id,
          eventType: 'message_received',
          actorType: 'system',
          actorUserId: null,
          payload: { messageId: message.id, messageType: input.messageType },
        }),
      );
      await manager.getRepository(InboxConversationEventEntity).save(
        manager.getRepository(InboxConversationEventEntity).create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          conversationId: conversation.id,
          eventType: activation.wouldActivate
            ? 'agent_activated'
            : 'agent_activation_ignored',
          actorType: 'system',
          actorUserId: null,
          payload: {
            policyVersion: activation.policyVersion,
            reasonCode: activation.reasonCode,
            exclusions: activation.exclusions,
          },
        }),
      );
      await this.writeOutbox(manager, input, conversation, message);
      await manager.getRepository(InboxDomainOutboxEntity).save(
        manager.getRepository(InboxDomainOutboxEntity).create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          aggregateType: 'inbox_conversation',
          aggregateId: conversation.id,
          eventName: 'leadflow.agent.activation.evaluated',
          eventVersion: 1,
          idempotencyKey: `agent.activation.evaluated:${message.id}`,
          payload: {
            conversationId: conversation.id,
            channelId: input.channelId,
            policyVersion: activation.policyVersion,
            wouldActivate: activation.wouldActivate,
            reasonCode: activation.reasonCode,
            exclusions: activation.exclusions,
            automaticEffects: {
              reply: false,
              crm: false,
              followUp: false,
            },
          },
          publishedAt: null,
        }),
      );

      if (
        conversation.ownershipState === 'ai_active' &&
        conversation.qualificationStatus === 'qualified'
      ) {
        await this.extendDebounce(manager, channel, conversation);
      }

      return { conversation, message, deduplicated: false };
    });

    if (!result.deduplicated) {
      void this.notificationPublisher.publishInboundMessage(result);
    }
    return result;
  }

  private async findInternalContact(
    manager: EntityManager,
    input: NormalizedInboundMessage,
  ) {
    if (input.channelType !== 'whatsapp' || !input.sender.phone) return null;
    const normalized = input.sender.phone.replace(/\D/g, '');
    if (!normalized) return null;
    return manager
      .getRepository(ContactEntity)
      .createQueryBuilder('contact')
      .innerJoin(
        ContactMethodEntity,
        'method',
        [
          'method.contact_id = contact.id',
          'method.tenant_id = contact.tenant_id',
          'method.workspace_id = contact.workspace_id',
        ].join(' AND '),
      )
      .where('contact.tenant_id = :tenantId', { tenantId: input.tenantId })
      .andWhere('contact.workspace_id = :workspaceId', {
        workspaceId: input.workspaceId,
      })
      .andWhere(
        "(contact.lifecycle_stage = 'internal' OR 'internal' = ANY(contact.lifecycle_stages))",
      )
      .andWhere("method.type IN ('phone', 'whatsapp')")
      .andWhere("regexp_replace(method.value, '\\D', '', 'g') = :normalized", {
        normalized,
      })
      .getOne();
  }

  private async qualify(
    manager: EntityManager,
    input: NormalizedInboundMessage,
  ) {
    const settings = await manager.getRepository(InboxSettingsEntity).findOne({
      where: { tenantId: input.tenantId, workspaceId: input.workspaceId },
    });
    const rules = settings?.leadRules ?? [];
    const channelRules = rules.filter((rule) => {
      const channel = typeof rule.channel === 'string' ? rule.channel : '';
      return (
        rule.enabled !== false && channel.toLowerCase() === input.channelType
      );
    });
    if (channelRules.length === 0 && input.channelType === 'whatsapp') {
      return { status: 'qualified' as const, reason: 'whatsapp_default' };
    }
    const text = input.content.toLocaleLowerCase('pt-BR');
    for (const rule of channelRules) {
      const mode = typeof rule.mode === 'string' ? rule.mode : '';
      const ruleId = typeof rule.id === 'string' ? rule.id : 'all';
      if (mode === 'all_conversations') {
        return {
          status: 'qualified' as const,
          reason: `rule:${ruleId}`,
        };
      }
      const keywords: unknown[] = Array.isArray(rule.keywords)
        ? (rule.keywords as unknown[])
        : [];
      const keyword = keywords.find(
        (item): item is string =>
          typeof item === 'string' &&
          text.includes(item.toLocaleLowerCase('pt-BR')),
      );
      if (keyword)
        return {
          status: 'qualified' as const,
          reason: `keyword:${keyword}`,
        };
    }
    return { status: 'disqualified' as const, reason: 'no_matching_rule' };
  }

  private async createMediaAssets(
    manager: EntityManager,
    input: NormalizedInboundMessage,
    conversation: InboxConversationEntity,
    message: InboxMessageEntity,
  ) {
    const repository = manager.getRepository(InboxMediaAssetEntity);
    const assets: InboxMediaAssetEntity[] = [];
    for (const attachment of input.attachments ?? []) {
      if (!attachment.externalId) continue;
      const kind = this.toMediaKind(attachment);
      if (!kind) continue;
      assets.push(
        await repository.save(
          repository.create({
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            conversationId: conversation.id,
            messageId: message.id,
            channelId: input.channelId,
            kind,
            provider: input.provider ?? 'unknown',
            externalMediaId: attachment.externalId,
            mimeType: attachment.mimeType ?? null,
            byteSize: attachment.size ? String(attachment.size) : null,
            checksum: this.readString(attachment.metadata?.sha256),
            safeFilename: this.safeFilename(attachment.filename),
            objectKey: null,
            status: 'pending',
            attemptCount: 0,
            nextAttemptAt: new Date(),
            availableAt: null,
            errorCode: null,
            metadata: {},
          }),
        ),
      );
    }
    return assets;
  }

  private async extendDebounce(
    manager: EntityManager,
    channel: InboxChannelEntity,
    conversation: InboxConversationEntity,
  ) {
    const secondsValue = Number(
      channel.settings?.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS,
    );
    const seconds = Number.isFinite(secondsValue)
      ? Math.min(300, Math.max(1, secondsValue))
      : DEFAULT_DEBOUNCE_SECONDS;
    const dueAt = new Date(Date.now() + seconds * 1000);
    const repository = manager.getRepository(InboxProcessingBatchEntity);
    const pending = await repository.findOne({
      where: {
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        status: 'pending',
      },
      order: { generation: 'DESC' },
    });
    if (pending) {
      pending.dueAt = dueAt;
      pending.messageCount += 1;
      await repository.save(pending);
      return;
    }
    const latest = await repository.findOne({
      where: {
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
      },
      order: { generation: 'DESC' },
    });
    await repository.save(
      repository.create({
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        channelId: channel.id,
        generation: (latest?.generation ?? 0) + 1,
        status: 'pending',
        dueAt,
        messageCount: 1,
        claimedAt: null,
        claimedBy: null,
        completedAt: null,
        errorCode: null,
      }),
    );
  }

  private async writeOutbox(
    manager: EntityManager,
    input: NormalizedInboundMessage,
    conversation: InboxConversationEntity,
    message: InboxMessageEntity,
  ) {
    await manager.getRepository(InboxDomainOutboxEntity).save(
      manager.getRepository(InboxDomainOutboxEntity).create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        aggregateType: 'inbox_conversation',
        aggregateId: conversation.id,
        eventName: 'leadflow.inbox.conversation.message.received',
        eventVersion: 1,
        idempotencyKey: `message.received:${message.id}`,
        payload: {
          conversationId: conversation.id,
          contactId: conversation.contactId,
          messageId: message.id,
          messageType: input.messageType,
        },
        publishedAt: null,
      }),
    );
  }

  private toPersistedMessageType(
    type: NormalizedInboundMessage['messageType'],
  ) {
    return type === 'text' ? 'text' : type === 'system' ? 'event' : 'media';
  }
  private toMediaKind(
    attachment: NormalizedInboundAttachment,
  ): InboxMediaKind | null {
    if (attachment.type === 'file') return 'document';
    return ['audio', 'image', 'video'].includes(attachment.type)
      ? (attachment.type as InboxMediaKind)
      : null;
  }
  private readProviderSequence(metadata?: Record<string, unknown>) {
    const value = metadata?.providerSequence;
    return typeof value === 'number' || typeof value === 'string'
      ? String(value)
      : null;
  }
  private readString(value: unknown) {
    return typeof value === 'string' ? value : null;
  }
  private safeFilename(value?: string | null) {
    if (!value) return null;
    return value.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 220);
  }
  private createPreview(content: string) {
    return content.trim().slice(0, 260);
  }
  private createConversationTitle(input: NormalizedInboundMessage) {
    return (
      input.sender.name ||
      input.sender.phone ||
      input.sender.email ||
      input.sender.username ||
      input.sender.externalId ||
      'Nova conversa'
    ).slice(0, 180);
  }
}
