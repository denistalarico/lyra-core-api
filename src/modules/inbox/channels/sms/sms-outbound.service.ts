import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { SettingsCryptoService } from '../../../../common/crypto/settings-crypto.service';
import { AssetAccessService } from '../../../../common/files/asset-access.service';
import { FilesService } from '../../../../common/files/files.service';
import { ContactMethodEntity } from '../../../contacts/entities/contact-method.entity';
import { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../../entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../../entities/inbox-message.entity';
import {
  inboxEntityMatchesScope,
  inboxScopeRequestContext,
} from '../../inbox-company-scope';
import { hasLeadFlowOutboundOptOut } from '../../services/leadflow-contact-opt-out';
import { assertAutomationSendConfirmed } from '../meta/meta-outbound-commands';
import { canonicalizeRecipient } from '../whatsapp/services/inbox-pilot-outbound-policy.service';
import { SmsProviderError } from './sms-provider.adapter';
import { SmsProviderRegistry } from './sms-provider.registry';

/** Telnyx accepts up to 1600 characters (§3.5); longer is refused, not cut. */
export const SMS_TEXT_MAX_LENGTH = 1600;
/** Telnyx MMS: each file under 1 MB. */
export const SMS_MMS_MAX_BYTES = 1024 * 1024;
const SMS_MMS_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);

/** Refusal codes the executor and the composer read. */
export const SMS_CONTACT_OPTED_OUT = 'sms_contact_opted_out';
export const SMS_RECIPIENT_UNAVAILABLE = 'sms_recipient_unavailable';
export const SMS_CHANNEL_UNAVAILABLE = 'sms_channel_unavailable';

export type SendSmsTextInput = {
  ctx: RequestContext;
  channelId: string;
  conversationId: string;
  to: string;
  text: string;
  idempotencyKey?: string;
};

export type SendSmsAgentTextInput = SendSmsTextInput & {
  idempotencyKey: string;
  agentId: string;
  ownershipVersion: number;
  decisionId: string;
  policyVersion: string;
};

export type SendSmsAutomationMessageInput = {
  tenantId: string;
  workspaceId: string;
  /** The conversation the cadence belongs to; it may be on another channel. */
  conversationId: string;
  automationId: string;
  idempotencyKey: string;
  text?: string | null;
  /** An SMS channel id; without it, the scope's connected SMS channel. */
  connectionRef?: string | null;
};

type SendSmsMediaInput = {
  ctx: RequestContext;
  channelId: string;
  conversationId: string;
  to: string;
  file: Express.Multer.File;
  caption?: string;
  idempotencyKey?: string;
};

type SmsActor =
  | { type: 'user'; userId: string | null }
  | {
      type: 'agent';
      agentId: string;
      ownershipVersion: number;
      decisionId: string;
      policyVersion: string;
    }
  | { type: 'automation'; automationId: string }
  /** The HELP answer (D-IX-8): carriers require it, even after STOP. */
  | { type: 'keyword_reply'; keyword: 'help' };

/**
 * The SMS channel's only way out (rule 8): ownership, opt-out, the 1600-char
 * ceiling and the pending row all live here, whoever is sending. SMS has no
 * messaging window, so nothing here is time-boxed; quiet hours for unattended
 * sends are the follow-up consumer's (item 10).
 */
@Injectable()
export class SmsOutboundService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    @InjectRepository(InboxConversationEntity, 'agency')
    private readonly conversationsRepository: Repository<InboxConversationEntity>,
    @InjectRepository(InboxMessageEntity, 'agency')
    private readonly messagesRepository: Repository<InboxMessageEntity>,
    private readonly cryptoService: SettingsCryptoService,
    private readonly filesService: FilesService,
    private readonly assetAccess: AssetAccessService,
    private readonly providers: SmsProviderRegistry,
  ) {}

  async sendText(input: SendSmsTextInput) {
    const { channel, conversation } = await this.resolveForContext(input);
    return this.deliver({
      channel,
      conversation,
      requestedTo: input.to,
      text: input.text,
      idempotencyKey: input.idempotencyKey,
      actor: { type: 'user', userId: input.ctx.userId ?? null },
    });
  }

  async sendAgentText(input: SendSmsAgentTextInput) {
    const { channel, conversation } = await this.resolveForContext(input);
    return this.deliver({
      channel,
      conversation,
      requestedTo: input.to,
      text: input.text,
      idempotencyKey: input.idempotencyKey,
      actor: {
        type: 'agent',
        agentId: input.agentId,
        ownershipVersion: input.ownershipVersion,
        decisionId: input.decisionId,
        policyVersion: input.policyVersion,
      },
    });
  }

  /**
   * The follow-up's SMS transport. On an SMS conversation it answers there;
   * from any other conversation (D+3/D+7 of a WhatsApp or Webchat lead) it
   * uses the contact's phone and the scope's SMS channel, reusing that
   * number's SMS conversation or opening one (§6 IX4 item 9).
   */
  async sendAutomationMessage(input: SendSmsAutomationMessageInput) {
    const text = input.text?.trim() ?? '';
    if (!text) throw new BadRequestException('sms_text_required');
    const origin = await this.conversationsRepository.findOne({
      where: {
        id: input.conversationId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      },
    });
    if (!origin) throw new NotFoundException('Inbox conversation not found.');
    const { channel, conversation } = await this.resolveAutomationTarget(
      origin,
      input.connectionRef ?? null,
    );
    const result = await this.deliver({
      channel,
      conversation,
      requestedTo: null,
      text,
      idempotencyKey: input.idempotencyKey,
      actor: { type: 'automation', automationId: input.automationId },
    });
    assertAutomationSendConfirmed(result.message);
    return result;
  }

  async sendMedia(input: SendSmsMediaInput) {
    if (!input.file) throw new BadRequestException('Arquivo não enviado.');
    const mimeType = (input.file.mimetype || '').toLowerCase().split(';')[0];
    if (!SMS_MMS_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(
        'No SMS só enviamos imagens (JPG, PNG ou GIF).',
      );
    }
    if (
      Math.max(input.file.size, input.file.buffer?.length ?? 0) >
      SMS_MMS_MAX_BYTES
    ) {
      throw new BadRequestException(
        'A imagem excede o limite de 1 MB do SMS (MMS).',
      );
    }
    const { channel, conversation } = await this.resolveForContext(input);
    // Every refusal runs before storage, so a refused send leaves no file.
    this.assertActorCanSend(conversation, {
      type: 'user',
      userId: input.ctx.userId ?? null,
    });
    this.assertNotOptedOut(conversation, { type: 'user', userId: null });
    const publicBase = this.publicApiBase();
    const ext =
      input.file.originalname.split('.').pop()?.toLowerCase() ?? 'bin';
    const stored = await this.filesService.uploadRawFile({
      file: input.file,
      path: `tenants/${channel.tenantId}/workspaces/${channel.workspaceId}/inbox/attachments/${Date.now()}-${randomUUID()}.${ext}`,
      maxBytes: SMS_MMS_MAX_BYTES,
    });
    // D-IX-2: Telnyx fetches the file through a signed, expiring URL that is
    // never persisted; the row keeps the plain path, signed on every read.
    const mediaUrl = `${new URL(stored.url, publicBase).toString()}?${this.assetAccess.issueGrant(stored.path, 'provider:telnyx', 3600).query}`;
    const caption = input.caption?.trim() ?? '';
    return this.deliver({
      channel,
      conversation,
      requestedTo: input.to,
      text: caption,
      mediaUrls: [mediaUrl],
      idempotencyKey: input.idempotencyKey,
      actor: { type: 'user', userId: input.ctx.userId ?? null },
      media: {
        url: stored.url,
        path: stored.path,
        name: input.file.originalname,
        mimeType: input.file.mimetype,
        size: input.file.size,
      },
    });
  }

  /** HELP answer, once per inbound message (the webhook may redeliver it). */
  async sendKeywordReply(input: {
    channel: InboxChannelEntity;
    conversation: InboxConversationEntity;
    inboundMessageId: string;
    text: string;
  }) {
    return this.deliver({
      channel: input.channel,
      conversation: input.conversation,
      requestedTo: null,
      text: input.text,
      idempotencyKey: `sms-help:${input.inboundMessageId}`,
      actor: { type: 'keyword_reply', keyword: 'help' },
    });
  }

  private async deliver(input: {
    channel: InboxChannelEntity;
    conversation: InboxConversationEntity;
    requestedTo: string | null;
    text: string;
    mediaUrls?: string[];
    media?: {
      url: string;
      path: string;
      name: string;
      mimeType: string;
      size: number;
    };
    idempotencyKey?: string;
    actor: SmsActor;
  }) {
    const { channel, conversation, actor } = input;
    const text = input.text.trim();
    if (!text && !input.mediaUrls?.length) {
      throw new BadRequestException('sms_text_required');
    }
    if (text.length > SMS_TEXT_MAX_LENGTH) {
      throw new BadRequestException(
        `O SMS aceita no máximo ${SMS_TEXT_MAX_LENGTH} caracteres.`,
      );
    }
    this.assertActorCanSend(conversation, actor);
    this.assertNotOptedOut(conversation, actor);
    if (actor.type === 'agent') {
      await this.assertGovernedReply(
        channel,
        conversation,
        input.idempotencyKey ?? '',
        actor,
      );
    }
    const recipient = this.resolveRecipient(
      input.requestedTo,
      conversation.externalThreadId,
    );
    const apiKey = this.cryptoService.decrypt(channel.accessTokenEncrypted);
    if (!apiKey || !channel.externalPhoneNumberId) {
      throw new BadRequestException(SMS_CHANNEL_UNAVAILABLE);
    }
    const adapter = this.providers.get(channel.provider);

    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const existing = await this.findIdempotentMessage(
      channel,
      conversation,
      idempotencyKey,
    );
    if (existing) return { conversation, message: existing, meta: {} };

    const mediaLabel = '[imagem]';
    const content = text || mediaLabel;
    const persistence = await this.persistPendingMessage(
      this.messagesRepository.create({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        channelId: channel.id,
        contactId: conversation.contactId ?? null,
        direction: 'outbound',
        senderType: senderType(actor),
        senderUserId: actor.type === 'user' ? actor.userId : null,
        senderAgentId: actor.type === 'agent' ? actor.agentId : null,
        externalMessageId: null,
        idempotencyKey,
        messageType: input.media ? 'media' : 'text',
        content,
        status: 'pending',
        attachments: input.media
          ? [{ ...input.media, kind: 'image' as const }]
          : [],
        metadata: {
          provider: channel.provider,
          channelType: 'sms',
          ...(input.media
            ? {
                mediaUrl: input.media.url,
                attachmentUrl: input.media.url,
                mimeType: input.media.mimeType,
                fileName: input.media.name,
                fileSize: input.media.size,
              }
            : {}),
          ...actorMetadata(actor),
        },
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        occurredAt: new Date(),
        providerSequence: null,
      }),
      channel,
      conversation,
    );
    const message = persistence.message;
    if (!persistence.created) return { conversation, message, meta: {} };

    let externalMessageId: string;
    try {
      ({ externalMessageId } = await adapter.send({
        apiKey,
        from: channel.externalPhoneNumberId,
        to: recipient,
        text,
        mediaUrls: input.mediaUrls,
      }));
    } catch (error) {
      const code =
        error instanceof SmsProviderError ? error.code : 'provider_send_failed';
      message.status = 'failed';
      message.metadata = {
        ...message.metadata,
        errorCode: code,
        ...(error instanceof SmsProviderError && error.providerCode
          ? { providerErrorCode: error.providerCode }
          : {}),
      };
      await this.messagesRepository.save(message);
      // Credentials or a refused number are not going to fix themselves;
      // anything else (timeout, 5xx) is worth the caller's retry.
      if (
        code === 'sms_credentials_invalid' ||
        code === 'provider_send_refused'
      ) {
        throw new BadRequestException('Não foi possível enviar o SMS.');
      }
      throw new ServiceUnavailableException('Não foi possível enviar o SMS.');
    }

    const sentAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      // Same key as the inbound ingestion: a fast status webhook for this id
      // waits for the id to be recorded.
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [
          `${channel.tenantId}:${channel.workspaceId}:${channel.id}:${conversation.externalThreadId}`,
        ],
      );
      message.externalMessageId = externalMessageId;
      message.status = 'sent';
      message.sentAt = sentAt;
      await manager.getRepository(InboxMessageEntity).save(message);
      conversation.lastMessagePreview = content.slice(0, 260);
      conversation.lastMessageAt = sentAt;
      if (conversation.status === 'new') conversation.status = 'open';
      await manager.getRepository(InboxConversationEntity).save(conversation);
      await manager.getRepository(InboxConversationEventEntity).save({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        eventType: 'message_sent',
        actorType: authorType(actor),
        actorUserId: actor.type === 'user' ? actor.userId : null,
        payload: {
          messageId: message.id,
          externalMessageId,
          channelId: channel.id,
          channelType: 'sms',
          provider: channel.provider,
          ...actorMetadata(actor),
        },
      });
      await manager.getRepository(InboxDomainOutboxEntity).save({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        aggregateType: 'inbox_conversation',
        aggregateId: conversation.id,
        eventName: 'leadflow.inbox.conversation.message.sent',
        eventVersion: 1,
        idempotencyKey: `message.sent:${message.id}`,
        payload: {
          conversationId: conversation.id,
          contactId: conversation.contactId,
          messageId: message.id,
          messageType: message.messageType,
          authorType: authorType(actor),
          ...(actor.type === 'automation'
            ? { automationId: actor.automationId }
            : {}),
        },
        publishedAt: null,
      });
    });
    return { conversation, message, meta: { externalMessageId } };
  }

  private async resolveForContext(input: {
    ctx: RequestContext;
    channelId: string;
    conversationId: string;
  }) {
    if (!input.ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const channel = await this.channelsRepository.findOne({
      where: {
        id: input.channelId,
        tenantId: input.ctx.tenantId,
        workspaceId: input.ctx.workspaceId,
        type: 'sms',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
    });
    if (!channel || !inboxEntityMatchesScope(input.ctx, channel)) {
      throw new NotFoundException('Active SMS channel not found.');
    }
    const conversation = await this.conversationsRepository.findOne({
      where: {
        id: input.conversationId,
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
      },
    });
    if (!conversation) {
      throw new NotFoundException('Inbox conversation not found for channel.');
    }
    return { channel, conversation };
  }

  private async resolveAutomationTarget(
    origin: InboxConversationEntity,
    connectionRef: string | null,
  ) {
    const scope = {
      tenantId: origin.tenantId,
      workspaceId: origin.workspaceId,
      scopeKind: origin.scopeKind,
      agencyClientId: origin.agencyClientId ?? IsNull(),
      companyContextId: origin.companyContextId ?? IsNull(),
    };
    const originChannel = origin.channelId
      ? await this.channelsRepository.findOne({
          where: { id: origin.channelId, ...scope },
        })
      : null;
    if (originChannel?.type === 'sms') {
      if (connectionRef && connectionRef !== originChannel.id) {
        throw new NotFoundException(
          'Configured SMS connection is not the conversation channel.',
        );
      }
      const ctx = inboxScopeRequestContext(origin);
      return this.resolveForContext({
        ctx,
        channelId: originChannel.id,
        conversationId: origin.id,
      });
    }

    const phone = await this.contactPhone(origin, originChannel);
    if (!phone) throw new NotFoundException(SMS_RECIPIENT_UNAVAILABLE);
    const candidates = await this.channelsRepository.find({
      where: {
        ...scope,
        ...(connectionRef ? { id: connectionRef } : {}),
        type: 'sms',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
    const channel = candidates[0];
    if (!channel) throw new BadRequestException(SMS_CHANNEL_UNAVAILABLE);

    const conversation = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${channel.tenantId}:${channel.workspaceId}:${channel.id}:${phone}`],
      );
      const repository = manager.getRepository(InboxConversationEntity);
      const existing = await repository.findOne({
        where: {
          tenantId: channel.tenantId,
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          externalThreadId: phone,
        },
      });
      if (existing) return existing;
      // The lead never wrote here: the conversation is the cadence's, so it
      // starts with the agent that owns the cadence and the origin's standing.
      return repository.save(
        repository.create({
          tenantId: channel.tenantId,
          workspaceId: channel.workspaceId,
          agencyClientId: channel.agencyClientId,
          companyContextId: channel.companyContextId,
          scopeKind: channel.scopeKind,
          channelId: channel.id,
          contactId: origin.contactId,
          opportunityId: null,
          externalThreadId: phone,
          title: origin.title || phone,
          status: 'open',
          priority: 'normal',
          assignedUserId: null,
          assignedAgentId: channel.defaultAgentId,
          source: 'sms',
          businessMode: origin.businessMode ?? 'general',
          lastMessagePreview: null,
          lastMessageAt: null,
          unreadCount: 0,
          aiEnabled: true,
          ownershipState: 'ai_active',
          ownershipVersion: 1,
          ownershipReason: 'followup_sms_started',
          ownershipChangedAt: new Date(),
          qualificationStatus: origin.qualificationStatus,
          qualificationReason: 'followup_sms_started',
          closedAt: null,
          archivedAt: null,
          metadata: {
            provider: channel.provider,
            channelType: 'sms',
            contactPhone: phone,
            ...(typeof origin.metadata?.contactName === 'string'
              ? { contactName: origin.metadata.contactName }
              : {}),
            originConversationId: origin.id,
          },
        }),
      );
    });
    return { channel, conversation };
  }

  /** The lead's phone, E.164: the WhatsApp thread, else the contact's methods. */
  private async contactPhone(
    origin: InboxConversationEntity,
    originChannel: InboxChannelEntity | null,
  ): Promise<string | null> {
    const candidates: string[] = [];
    if (originChannel?.type === 'whatsapp' && origin.externalThreadId) {
      candidates.push(origin.externalThreadId);
    }
    if (origin.contactId) {
      const methods = await this.dataSource
        .getRepository(ContactMethodEntity)
        .find({
          where: {
            tenantId: origin.tenantId,
            workspaceId: origin.workspaceId,
            contactId: origin.contactId,
            type: In(['phone', 'whatsapp']),
          },
          order: { isPrimary: 'DESC', createdAt: 'ASC' },
        });
      candidates.push(...methods.map((method) => method.value));
    }
    if (typeof origin.metadata?.contactPhone === 'string') {
      candidates.push(origin.metadata.contactPhone);
    }
    for (const candidate of candidates) {
      const digits = candidate.replace(/\D/g, '');
      try {
        return canonicalizeRecipient(`+${digits}`);
      } catch {
        continue;
      }
    }
    return null;
  }

  private assertActorCanSend(
    conversation: InboxConversationEntity,
    actor: SmsActor,
  ) {
    if (
      actor.type === 'user' &&
      conversation.ownershipState !== 'human_active'
    ) {
      throw new ConflictException(
        'A user must assume the conversation before replying through its channel.',
      );
    }
    if (
      actor.type === 'agent' &&
      (conversation.ownershipState !== 'ai_active' ||
        !conversation.aiEnabled ||
        conversation.ownershipVersion !== actor.ownershipVersion)
    ) {
      throw new ConflictException(
        'AI send blocked by current conversation ownership.',
      );
    }
    if (
      actor.type === 'automation' &&
      (conversation.ownershipState !== 'ai_active' || !conversation.aiEnabled)
    ) {
      throw new ConflictException(
        'Automatic message blocked by current conversation ownership.',
      );
    }
  }

  /** D-IX-8: after STOP nothing leaves but the HELP answer, until START. */
  private assertNotOptedOut(
    conversation: InboxConversationEntity,
    actor: SmsActor,
  ) {
    if (
      actor.type !== 'keyword_reply' &&
      hasLeadFlowOutboundOptOut(conversation)
    ) {
      throw new ConflictException(SMS_CONTACT_OPTED_OUT);
    }
  }

  private async assertGovernedReply(
    channel: InboxChannelEntity,
    conversation: InboxConversationEntity,
    idempotencyKey: string,
    actor: Extract<SmsActor, { type: 'agent' }>,
  ) {
    const [authorization] = await this.dataSource.query<
      Array<{ policy_outcome: string; status: string; reply_enabled: boolean }>
    >(
      `SELECT action.policy_outcome,action.status,
              COALESCE(control.reply_enabled,true) reply_enabled
         FROM inbox_governed_actions action
         LEFT JOIN inbox_autonomy_controls control
           ON control.tenant_id=action.tenant_id
          AND control.workspace_id=action.workspace_id
        WHERE action.tenant_id=$1 AND action.workspace_id=$2
          AND action.conversation_id=$3 AND action.decision_id=$4
          AND action.idempotency_key=$5 AND action.action_type='reply'
          AND action.policy_version=$6`,
      [
        channel.tenantId,
        channel.workspaceId,
        conversation.id,
        actor.decisionId,
        idempotencyKey,
        actor.policyVersion,
      ],
    );
    if (
      !authorization ||
      authorization.policy_outcome !== 'allowed' ||
      !['planned', 'claimed', 'applied'].includes(authorization.status) ||
      !authorization.reply_enabled
    ) {
      throw new ConflictException(
        'Automatic reply blocked by governed policy.',
      );
    }
  }

  /**
   * The thread is the lead's E.164 number. A caller that names a recipient
   * must name that one: the composer cannot redirect a conversation.
   */
  private resolveRecipient(
    requested: string | null,
    externalThreadId: string | null,
  ) {
    let thread: string;
    try {
      thread = canonicalizeRecipient(
        `+${(externalThreadId ?? '').replace(/\D/g, '')}`,
      );
    } catch {
      throw new BadRequestException('SMS recipient identity is invalid.');
    }
    if (requested !== null && requested.trim()) {
      const supplied = `+${requested.replace(/\D/g, '')}`;
      if (supplied !== thread) {
        throw new BadRequestException('SMS recipient identity is invalid.');
      }
    }
    return thread;
  }

  private async persistPendingMessage(
    message: InboxMessageEntity,
    channel: InboxChannelEntity,
    conversation: InboxConversationEntity,
  ): Promise<{ message: InboxMessageEntity; created: boolean }> {
    try {
      return {
        message: await this.messagesRepository.save(message),
        created: true,
      };
    } catch (error) {
      const raced = message.idempotencyKey
        ? await this.findIdempotentMessage(
            channel,
            conversation,
            message.idempotencyKey,
          )
        : null;
      if (!raced) throw error;
      return { message: raced, created: false };
    }
  }

  private async findIdempotentMessage(
    channel: InboxChannelEntity,
    conversation: InboxConversationEntity,
    idempotencyKey: string,
  ) {
    const existing = await this.messagesRepository.findOne({
      where: {
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        idempotencyKey,
      },
    });
    if (
      existing &&
      (existing.channelId !== channel.id ||
        existing.conversationId !== conversation.id)
    ) {
      throw new ConflictException('Outbound idempotency intent changed.');
    }
    return existing;
  }

  private publicApiBase() {
    const base =
      process.env.API_PUBLIC_URL?.trim() ||
      process.env.AGENCY_PUBLIC_API_URL?.trim() ||
      process.env.META_WEBHOOK_CALLBACK_URL?.trim();
    if (!base) {
      throw new BadRequestException(
        'Public API URL is not configured for media.',
      );
    }
    return base;
  }
}

function senderType(actor: SmsActor): InboxMessageEntity['senderType'] {
  if (actor.type === 'agent') return 'agent';
  if (actor.type === 'user') return 'user';
  return 'system';
}

function authorType(actor: SmsActor): 'user' | 'agent' | 'system' {
  if (actor.type === 'agent') return 'agent';
  if (actor.type === 'user') return 'user';
  return 'system';
}

function actorMetadata(actor: SmsActor): Record<string, unknown> {
  if (actor.type === 'agent') {
    return {
      agentDecisionId: actor.decisionId,
      policyVersion: actor.policyVersion,
      ownershipVersion: actor.ownershipVersion,
    };
  }
  if (actor.type === 'automation') return { automationId: actor.automationId };
  if (actor.type === 'keyword_reply') return { smsKeywordReply: actor.keyword };
  return {};
}
