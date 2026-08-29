import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ContactEntity } from '../../../contacts/entities/contact.entity';
import { ContactMethodEntity } from '../../../contacts/entities/contact-method.entity';
import { InboxAttributionObservationEntity } from '../../entities/inbox-attribution-observation.entity';
import { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../entities/inbox-conversation-event.entity';
import { recordQualificationTransition } from '../../services/qualification-transition.recorder';
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
import { readAttributionObservation } from '../types/inbound-attribution-observation';
import { AgentActivationPolicyService } from '../../services/agent-activation-policy.service';
import { ContactRelationshipResolver } from '../../services/contact-relationship.resolver';
import { InboxRuntimeConfigService } from '../../runtime/inbox-runtime-config.service';
import {
  isExplicitLeadFlowOptOut,
  recordLeadFlowOutboundOptOut,
} from '../../services/leadflow-contact-opt-out';

const DEFAULT_DEBOUNCE_SECONDS = 20;

@Injectable()
export class InboundMessageIngestionService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly notificationPublisher: InboxNotificationPublisher,
    private readonly activationPolicy?: AgentActivationPolicyService,
    @Optional() private readonly runtimeConfig?: InboxRuntimeConfigService,
    @Optional()
    private readonly contactRelationshipResolver?: ContactRelationshipResolver,
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
      const explicitOptOut = isExplicitLeadFlowOptOut(input.content);
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
      const contactRelationship = this.contactRelationshipResolver
        ? await this.contactRelationshipResolver.resolve(manager, {
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            contactId: conversation?.contactId ?? internalContact?.id ?? null,
            isInternalUser: Boolean(internalContact),
            qualificationStatus: qualification.status,
          })
        : undefined;
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
            contactRelationship,
            contactOptOut: explicitOptOut,
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
            ...this.createConversationIdentityMetadata(input),
          },
        });
        conversation = await manager
          .getRepository(InboxConversationEntity)
          .save(conversation);
        // A conversation can be born qualified: the inbound rules run before
        // the row exists, so for WhatsApp/Instagram/Messenger the common case
        // is created-and-qualified in one step. Recording it as a transition
        // from the column's own default is what makes the first qualification
        // observable at all — skip it and the history would only ever contain
        // the rarer later promotions, and a July count would be mostly zero.
        await recordQualificationTransition(manager, {
          conversation,
          previousStatus: 'pending',
          newStatus: qualification.status,
          reason: qualification.reason,
          actor: { type: 'system' },
          occurredAt,
        });
      } else if (internalContact) {
        conversation.contactId = internalContact.id;
        await recordQualificationTransition(manager, {
          conversation,
          previousStatus: conversation.qualificationStatus,
          newStatus: 'internal',
          reason: 'workspace_internal_contact',
          actor: { type: 'system' },
          occurredAt,
        });
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
        await recordQualificationTransition(manager, {
          conversation,
          previousStatus: conversation.qualificationStatus,
          newStatus: 'qualified',
          reason: qualification.reason,
          actor: { type: 'system' },
          occurredAt,
        });
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

      const enrichedIdentity = this.createConversationIdentityMetadata(input);
      conversation.metadata = {
        ...(conversation.metadata ?? {}),
        ...enrichedIdentity,
      };
      if (this.shouldReplaceConversationTitle(conversation.title, input)) {
        conversation.title = this.createConversationTitle(input);
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
            senderName: input.sender.name ?? null,
            senderUsername: input.sender.username ?? null,
            senderAvatarUrl: this.readString(input.sender.metadata?.avatarUrl),
          },
          sentAt: occurredAt,
          deliveredAt: null,
          readAt: null,
          occurredAt,
          providerSequence: this.readProviderSequence(input.metadata),
        }),
      );

      if (explicitOptOut) {
        conversation.metadata = recordLeadFlowOutboundOptOut(
          conversation.metadata,
          {
            recordedAt: occurredAt,
            sourceMessageId: message.id,
          },
        );
        conversation.aiEnabled = false;
        if (conversation.ownershipState === 'ai_active') {
          conversation.ownershipState = 'paused';
          conversation.ownershipVersion += 1;
          conversation.ownershipChangedAt = occurredAt;
          conversation.ownershipReason = 'contact_opt_out';
        }
      }

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

      await this.recordAttributionObservation(
        manager,
        input,
        channel,
        conversation,
        message,
        occurredAt,
      );

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
        (this.runtimeConfig?.ingestionWorkerEnabled ?? true) &&
        conversation.ownershipState === 'ai_active' &&
        conversation.qualificationStatus === 'qualified'
      ) {
        await this.extendDebounce(manager, channel, conversation);
      }

      return { conversation, message, channel, deduplicated: false };
    });

    if (!result.deduplicated) {
      void this.notificationPublisher.publishInboundMessage(result);
    }
    return result;
  }

  /**
   * A dedicated path for messages the business itself sent through a
   * channel-native surface outside this system (e.g. an operator replying
   * from Meta's own Page Inbox) or for reconciling our own outbound send
   * against a fast echo. Never routes through ingest(): that method fixes
   * direction to 'inbound', which would misattribute either case as a
   * message from the contact. Takes the same per-thread advisory lock as
   * ingest() and the same lock now held by the outbound services while they
   * write externalMessageId, so the two can never race on the same mid.
   * Requires an existing conversation — an echo carries no qualification or
   * ownership signal, so one is never fabricated here.
   */
  async ingestEcho(input: NormalizedInboundMessage) {
    return this.dataSource.transaction(async (manager) => {
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

      const conversation = await manager
        .getRepository(InboxConversationEntity)
        .findOne({
          where: {
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            channelId: input.channelId,
            externalThreadId: input.externalThreadId,
          },
        });
      if (!conversation) return null;

      const occurredAt = input.occurredAt ?? new Date();
      const message = await manager.getRepository(InboxMessageEntity).save(
        manager.getRepository(InboxMessageEntity).create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          conversationId: conversation.id,
          channelId: input.channelId,
          contactId: conversation.contactId,
          direction: 'outbound',
          senderType: 'external',
          senderUserId: null,
          senderAgentId: null,
          externalMessageId: input.externalMessageId ?? null,
          messageType: this.toPersistedMessageType(input.messageType),
          content: input.content,
          status: 'sent',
          attachments: [],
          metadata: {
            provider: input.provider ?? null,
            channelType: input.channelType,
            senderExternalId: input.sender.externalId,
            externalSend: true,
          },
          sentAt: occurredAt,
          deliveredAt: null,
          readAt: null,
          occurredAt,
          providerSequence: this.readProviderSequence(input.metadata),
        }),
      );

      conversation.lastMessagePreview = this.createPreview(input.content);
      conversation.lastMessageAt = occurredAt;
      await manager.getRepository(InboxConversationEntity).save(conversation);

      await manager.getRepository(InboxConversationEventEntity).save(
        manager.getRepository(InboxConversationEventEntity).create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          conversationId: conversation.id,
          eventType: 'message_sent',
          actorType: 'system',
          actorUserId: null,
          payload: {
            messageId: message.id,
            externalMessageId: input.externalMessageId ?? null,
            channelId: input.channelId,
            channelType: input.channelType,
            provider: input.provider ?? null,
            externalSend: true,
          },
        }),
      );
      await manager.getRepository(InboxDomainOutboxEntity).save(
        manager.getRepository(InboxDomainOutboxEntity).create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          aggregateType: 'inbox_conversation',
          aggregateId: conversation.id,
          eventName: 'leadflow.inbox.conversation.message.sent',
          eventVersion: 1,
          idempotencyKey: `message.sent:${message.id}`,
          payload: {
            conversationId: conversation.id,
            contactId: conversation.contactId,
            messageId: message.id,
            messageType: input.messageType,
            authorType: 'external',
          },
          publishedAt: null,
        }),
      );

      return { conversation, message, deduplicated: false };
    });
  }

  /**
   * Matches an inbound sender against a contact explicitly marked
   * `lifecycle_stage = 'internal'` — the only signal that suppresses agent
   * activation regardless of qualification (see ContactRelationship.InternalUser).
   *
   * Only channels with a stable, user-enterable identifier are wired: phone
   * for WhatsApp/SMS, username for Instagram. Facebook Messenger has no
   * username at all (only an opaque PSID), so a "Facebook" contact method
   * exists for reference but is never matched here — the rule simply does
   * not apply on that channel. TikTok isn't a live Inbox channel yet, so its
   * contact method is stored but unused until then.
   */
  private async findInternalContact(
    manager: EntityManager,
    input: NormalizedInboundMessage,
  ) {
    if (input.channelType === 'whatsapp' && input.sender.phone) {
      const normalized = input.sender.phone.replace(/\D/g, '');
      if (!normalized) return null;
      return this.internalContactQuery(manager, input)
        .andWhere("method.type IN ('phone', 'whatsapp')")
        .andWhere(
          "regexp_replace(method.value, '\\D', '', 'g') = :normalized",
          { normalized },
        )
        .getOne();
    }
    if (input.channelType === 'instagram' && input.sender.username) {
      const normalized = input.sender.username
        .trim()
        .replace(/^@/, '')
        .toLowerCase();
      if (!normalized) return null;
      return this.internalContactQuery(manager, input)
        .andWhere("method.type = 'instagram'")
        .andWhere(
          "lower(regexp_replace(method.value, '^@', '')) = :normalized",
          { normalized },
        )
        .getOne();
    }
    return null;
  }

  private internalContactQuery(
    manager: EntityManager,
    input: NormalizedInboundMessage,
  ) {
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
      );
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
    if (
      channelRules.length === 0 &&
      ['whatsapp', 'instagram', 'facebook_messenger'].includes(
        input.channelType,
      )
    ) {
      return {
        status: 'qualified' as const,
        reason: `${input.channelType}_default`,
      };
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
            metadata: attachment.metadata ?? {},
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

  /**
   * Records how this message arrived, when the provider said so.
   *
   * Only ever called from `ingest()`, which is the inbound path. Echoes go
   * through `ingestEcho()` and outbound sends never touch this service at all:
   * a referral is something a contact's click produced, and attaching one to a
   * message the business sent would invent a click that never happened.
   *
   * Writes nothing when the provider sent nothing. The absence of a row is the
   * representation of "we did not observe an origin" — there is no `unknown`
   * row, because a row asserts an observation and this is the case where none
   * was made. Conversations that predate this table are in exactly that state
   * and stay there; Meta does not expose the referral of a past message, so
   * there is no backfill to run.
   *
   * `ON CONFLICT DO NOTHING` against the per-message unique key rather than a
   * read-then-write: two deliveries of the same webhook can be in flight
   * concurrently, and the first observation is the one that stands.
   */
  private async recordAttributionObservation(
    manager: EntityManager,
    input: NormalizedInboundMessage,
    channel: InboxChannelEntity,
    conversation: InboxConversationEntity,
    message: InboxMessageEntity,
    occurredAt: Date,
  ) {
    const observation = readAttributionObservation(input.metadata);
    if (!observation) return;

    const repository = manager.getRepository(InboxAttributionObservationEntity);

    await repository
      .createQueryBuilder()
      .insert()
      .values({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        // Resolved from the channel here and then frozen on the row. The
        // Inbox derives the client binding from the channel on every read,
        // which is right for a conversation and wrong for a fact: this row
        // states what was true when the message arrived, and re-pointing the
        // channel later must not re-attribute historical spend.
        agencyClientId: this.readString(channel.metadata?.clientId),
        conversationId: conversation.id,
        messageId: message.id,
        channelId: input.channelId,
        provider: input.provider ?? 'unknown',
        channelType: input.channelType,
        adId: observation.adId ?? null,
        clickId: observation.clickId ?? null,
        sourceType: observation.sourceType ?? null,
        observedAt: occurredAt,
      })
      .orIgnore()
      .execute();
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
    const username = input.sender.username?.trim();
    return (
      input.sender.name?.trim() ||
      input.sender.phone?.trim() ||
      (username
        ? username.startsWith('@')
          ? username
          : `@${username}`
        : '') ||
      input.sender.email?.trim() ||
      (input.channelType === 'instagram'
        ? 'Lead do Instagram'
        : input.channelType === 'whatsapp'
          ? 'Lead do WhatsApp'
          : input.channelType === 'facebook_messenger'
            ? 'Lead do Messenger'
            : 'Nova conversa')
    ).slice(0, 180);
  }

  private createConversationIdentityMetadata(input: NormalizedInboundMessage) {
    return Object.fromEntries(
      Object.entries({
        contactName: input.sender.name?.trim() || null,
        contactPhone: input.sender.phone?.trim() || null,
        contactEmail: input.sender.email?.trim() || null,
        username: input.sender.username?.trim() || null,
        avatarUrl: this.readString(input.sender.metadata?.avatarUrl),
        externalParticipantId: input.sender.externalId,
      }).filter(([, value]) => Boolean(value)),
    );
  }

  private shouldReplaceConversationTitle(
    title: string | null,
    input: NormalizedInboundMessage,
  ) {
    const normalized = title?.trim() ?? '';
    if (!normalized) return true;
    if (
      normalized === input.sender.externalId ||
      normalized === input.externalThreadId
    ) {
      return true;
    }
    return (
      /^\d{8,}$/.test(normalized) ||
      /^instagram:/i.test(normalized) ||
      [
        'Nova conversa',
        'Conversa sem título',
        'Lead do Instagram',
        'Lead do Messenger',
      ].includes(normalized)
    );
  }
}
