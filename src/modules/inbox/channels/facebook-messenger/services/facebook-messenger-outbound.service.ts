import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../../../../common/context/request-context.interface';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { FilesService } from '../../../../../common/files/files.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../../../entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../../../entities/inbox-message.entity';
import { InstagramAudioNormalizerService } from '../../instagram/services/instagram-audio-normalizer.service';
import { InboxMetaOperationLedgerService } from '../../whatsapp/services/inbox-meta-operation-ledger.service';

/**
 * The Messenger standard messaging window: a business may reply for 24 hours
 * after the contact's last message. Outside it Meta only accepts tagged or
 * template traffic, which this sprint deliberately does not implement — the
 * send is refused instead of being silently downgraded.
 */
const STANDARD_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const FACEBOOK_MESSENGER_WINDOW_CLOSED =
  'facebook_messenger_outside_standard_messaging_window';

const MESSENGER_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

type SendMessengerTextInput = {
  ctx: RequestContext;
  channelId: string;
  conversationId: string;
  to: string;
  text: string;
  replyToMessageId?: string;
  idempotencyKey?: string;
};

type SendMessengerAgentTextInput = SendMessengerTextInput & {
  idempotencyKey: string;
  agentId: string;
  ownershipVersion: number;
  decisionId: string;
  policyVersion: string;
};

type MessengerTextActor =
  | { type: 'user' }
  | {
      type: 'agent';
      agentId: string;
      ownershipVersion: number;
      decisionId: string;
      policyVersion: string;
    };

/**
 * Messenger accepts `file` in addition to the three media kinds Instagram
 * takes, so a document sent from the composer is a first-class attachment here.
 */
type MessengerMediaType = 'audio' | 'file' | 'image' | 'video';

type SendMessengerMediaInput = {
  ctx: RequestContext;
  channelId: string;
  conversationId: string;
  to: string;
  file: Express.Multer.File;
  caption?: string;
  idempotencyKey?: string;
};

type MessengerSendResponse = {
  recipient_id?: string;
  message_id?: string;
  error?: unknown;
  error_subcode?: unknown;
};

const MEDIA_LABELS: Record<MessengerMediaType, string> = {
  audio: '[áudio]',
  file: '[arquivo]',
  image: '[imagem]',
  video: '[vídeo]',
};

@Injectable()
export class FacebookMessengerOutboundService {
  private readonly logger = new Logger(FacebookMessengerOutboundService.name);

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
    private readonly metaLedger: InboxMetaOperationLedgerService,
    // Shared with Instagram: both Meta surfaces reject the OGG/WebM the browser
    // recorder produces, and the normalizer is channel-agnostic AAC transcode.
    private readonly audioNormalizer: InstagramAudioNormalizerService,
  ) {}

  async sendText(input: SendMessengerTextInput) {
    return this.sendTextForActor(input, { type: 'user' });
  }

  async sendAgentText(input: SendMessengerAgentTextInput) {
    return this.sendTextForActor(input, {
      type: 'agent',
      agentId: input.agentId,
      ownershipVersion: input.ownershipVersion,
      decisionId: input.decisionId,
      policyVersion: input.policyVersion,
    });
  }

  private async sendTextForActor(
    input: SendMessengerTextInput,
    actor: MessengerTextActor,
  ) {
    const { channel, conversation, accessToken, recipient } =
      await this.resolveSendContext(input);
    this.assertActorCanSend(conversation, actor);
    if (actor.type === 'agent') {
      await this.assertGovernedReply(channel, conversation, input, actor);
    }
    await this.assertStandardMessagingWindow(channel, conversation);

    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const existing = await this.findIdempotentMessage(
      channel,
      conversation,
      idempotencyKey,
    );
    const recipientAuthorization = this.recipientAuthorization(recipient);
    if (existing) {
      await this.metaLedger.replay({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        conversationId: conversation.id,
        operation: 'facebook_messenger_send_text',
        idempotencyKey,
        recipient: recipientAuthorization,
      });
      return { conversation, message: existing, meta: {} };
    }

    const replyTarget = input.replyToMessageId
      ? await this.messagesRepository.findOne({
          where: {
            id: input.replyToMessageId,
            tenantId: channel.tenantId,
            workspaceId: channel.workspaceId,
            conversationId: conversation.id,
          },
        })
      : null;
    // Messenger documents `message.reply_to.mid`, so a reply is native as long
    // as the quoted message carries the Meta id. A locally created message has
    // no mid, and there the quote stays a UI-only decoration.
    const nativeReplyMid = replyTarget?.externalMessageId?.trim() || null;
    const text = input.text.trim();
    const now = new Date();
    const persistence = await this.persistPendingMessage(
      this.messagesRepository.create({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        channelId: channel.id,
        contactId: conversation.contactId ?? null,
        direction: 'outbound',
        senderType: actor.type === 'agent' ? 'agent' : 'user',
        senderUserId: actor.type === 'user' ? (input.ctx.userId ?? null) : null,
        senderAgentId: actor.type === 'agent' ? actor.agentId : null,
        externalMessageId: null,
        idempotencyKey,
        messageType: 'text',
        content: text,
        status: 'pending',
        attachments: [],
        metadata: {
          provider: 'meta',
          channelType: 'facebook_messenger',
          ...(replyTarget
            ? {
                replyToMessageId: replyTarget.id,
                replyToPreview: replyTarget.content.slice(0, 160),
                nativeReplySupported: Boolean(nativeReplyMid),
              }
            : {}),
          ...(actor.type === 'agent'
            ? {
                agentDecisionId: actor.decisionId,
                policyVersion: actor.policyVersion,
                ownershipVersion: actor.ownershipVersion,
              }
            : {}),
        },
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        occurredAt: now,
        providerSequence: null,
      }),
      channel,
      conversation,
    );
    const message = persistence.message;
    if (!persistence.created) {
      return { conversation, message, meta: {} };
    }

    const ledger = await this.metaLedger.reserve({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      conversationId: conversation.id,
      messageId: message.id,
      operation: 'facebook_messenger_send_text',
      idempotencyKey,
      recipient: recipientAuthorization,
    });
    const startedMs = Date.now();
    let response: MessengerSendResponse;
    try {
      await this.metaLedger.started(ledger);
      response = await this.sendToMeta(channel, accessToken, {
        recipient: { id: recipient },
        messaging_type: 'RESPONSE',
        message: {
          text,
          ...(nativeReplyMid ? { reply_to: { mid: nativeReplyMid } } : {}),
        },
      });
      await this.metaLedger.succeeded(ledger, startedMs, response.message_id);
    } catch (error) {
      await this.metaLedger.failed(ledger, startedMs, error);
      await this.failMessage(message);
      throw error;
    }

    await this.completeMessage({
      channel,
      conversation,
      message,
      externalMessageId: response.message_id ?? null,
      preview: text,
      actor,
    });
    return { conversation, message, meta: response };
  }

  async sendMedia(input: SendMessengerMediaInput) {
    if (!input.file) throw new BadRequestException('Arquivo não enviado.');
    const mediaType = this.resolveMediaType(input.file.mimetype);
    const { channel, conversation, accessToken, recipient } =
      await this.resolveSendContext(input);
    this.assertActorCanSend(conversation, { type: 'user' });
    await this.assertStandardMessagingWindow(channel, conversation);

    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const existing = await this.findIdempotentMessage(
      channel,
      conversation,
      idempotencyKey,
    );
    const recipientAuthorization = this.recipientAuthorization(recipient);
    if (existing) {
      await this.metaLedger.replay({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        conversationId: conversation.id,
        operation: 'facebook_messenger_send_media',
        idempotencyKey,
        recipient: recipientAuthorization,
      });
      return { conversation, message: existing, meta: {} };
    }

    const mediaFile =
      mediaType === 'audio'
        ? await this.audioNormalizer.normalize(input.file)
        : input.file;
    const ext = mediaFile.originalname.split('.').pop()?.toLowerCase() ?? 'bin';
    const stored = await this.filesService.uploadRawFile({
      file: mediaFile,
      path: `tenants/${channel.tenantId}/workspaces/${channel.workspaceId}/inbox/attachments/${Date.now()}-${randomUUID()}.${ext}`,
      maxBytes: MESSENGER_MEDIA_MAX_BYTES,
    });
    // Meta fetches the attachment from this URL, so it must be the public API
    // origin — the storage path alone is not reachable from Meta's servers.
    const mediaUrl = this.absoluteAssetUrl(stored.url);
    const caption = input.caption?.trim() || '';
    const label = MEDIA_LABELS[mediaType];
    const persistence = await this.persistPendingMessage(
      this.messagesRepository.create({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        channelId: channel.id,
        contactId: conversation.contactId ?? null,
        direction: 'outbound',
        senderType: 'user',
        senderUserId: input.ctx.userId ?? null,
        senderAgentId: null,
        externalMessageId: null,
        idempotencyKey,
        messageType: 'media',
        content: caption || label,
        status: 'pending',
        attachments: [
          {
            url: stored.url,
            path: stored.path,
            name: mediaFile.originalname,
            mimeType: mediaFile.mimetype,
            size: mediaFile.size,
            kind: mediaType,
          },
        ],
        metadata: {
          provider: 'meta',
          channelType: 'facebook_messenger',
          mediaUrl: stored.url,
          attachmentUrl: stored.url,
          mimeType: mediaFile.mimetype,
          fileName: mediaFile.originalname,
          fileSize: mediaFile.size,
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
    if (!persistence.created) {
      return { conversation, message, meta: {} };
    }

    const ledger = await this.metaLedger.reserve({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      conversationId: conversation.id,
      messageId: message.id,
      operation: 'facebook_messenger_send_media',
      idempotencyKey,
      recipient: recipientAuthorization,
    });
    const startedMs = Date.now();
    let response: MessengerSendResponse;
    try {
      await this.metaLedger.started(ledger);
      response = await this.sendToMeta(channel, accessToken, {
        recipient: { id: recipient },
        messaging_type: 'RESPONSE',
        message: {
          attachment: { type: mediaType, payload: { url: mediaUrl } },
        },
      });
      await this.metaLedger.succeeded(ledger, startedMs, response.message_id);
    } catch (error) {
      await this.metaLedger.failed(ledger, startedMs, error);
      await this.failMessage(message);
      throw error;
    }

    await this.completeMessage({
      channel,
      conversation,
      message,
      externalMessageId: response.message_id ?? null,
      preview: caption || label,
      actor: { type: 'user' },
    });
    return { conversation, message, meta: response };
  }

  /**
   * Messenger sender actions are a separate request from a message, and the
   * react/unreact pair accepts any emoji — unlike Instagram, which only takes
   * the single `love` reaction.
   */
  async deliverReaction(input: {
    conversation: InboxConversationEntity;
    message: InboxMessageEntity;
    emoji: string;
  }): Promise<boolean> {
    const channelId = input.message.channelId ?? input.conversation.channelId;
    const externalMessageId = input.message.externalMessageId;
    if (!channelId || !externalMessageId) return false;

    const channel = await this.channelsRepository.findOne({
      where: {
        id: channelId,
        tenantId: input.conversation.tenantId,
        workspaceId: input.conversation.workspaceId,
        type: 'facebook_messenger',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
    });
    if (!channel) return false;
    const accessToken = this.cryptoService.decrypt(
      channel.accessTokenEncrypted,
    );
    if (!accessToken) return false;
    const recipient = this.resolveRecipient(
      '',
      channel,
      input.conversation.externalThreadId,
      input.conversation.metadata,
    );

    await this.sendToMeta(channel, accessToken, {
      recipient: { id: recipient },
      sender_action: input.emoji ? 'react' : 'unreact',
      payload: {
        message_id: externalMessageId,
        ...(input.emoji ? { reaction: input.emoji } : {}),
      },
    });
    return true;
  }

  private async resolveSendContext(input: {
    ctx: RequestContext;
    channelId: string;
    conversationId: string;
    to: string;
  }) {
    const channel = await this.channelsRepository.findOne({
      where: {
        id: input.channelId,
        tenantId: input.ctx.tenantId,
        workspaceId: this.requireWorkspaceId(input.ctx),
        type: 'facebook_messenger',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
    });
    if (
      !channel ||
      !this.resolvePageId(channel) ||
      !this.channelMatchesContext(input.ctx, channel)
    ) {
      throw new NotFoundException(
        'Active Facebook Messenger channel not found.',
      );
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
    const accessToken = this.cryptoService.decrypt(
      channel.accessTokenEncrypted,
    );
    if (!accessToken) {
      throw new BadRequestException(
        'Facebook Messenger access token is not configured.',
      );
    }
    const recipient = this.resolveRecipient(
      input.to,
      channel,
      conversation.externalThreadId,
      conversation.metadata,
    );
    return { channel, conversation, accessToken, recipient };
  }

  /**
   * The recipient is the Page-scoped ID persisted by the inbound pipeline —
   * never a phone number, never an Instagram-scoped id, and never the Page id
   * itself (which would make the Page message itself).
   */
  private resolveRecipient(
    requested: string,
    channel: InboxChannelEntity,
    externalThreadId: string | null,
    metadata: Record<string, unknown>,
  ) {
    const metadataId =
      typeof metadata.externalParticipantId === 'string'
        ? metadata.externalParticipantId.trim()
        : '';
    const threadId = externalThreadId?.trim() ?? '';
    const derived =
      metadataId ||
      (threadId.startsWith('facebook_messenger:')
        ? (threadId.split(':').at(-1) ?? '')
        : '');
    const suppliedRaw = requested.trim();
    // Governed AI actions carry the canonical conversation thread, while UI
    // sends carry the scoped recipient directly. Both must resolve to the same
    // participant before a request is allowed out.
    const supplied = suppliedRaw === threadId ? derived : suppliedRaw;
    if (!derived || (supplied && supplied !== derived)) {
      throw new BadRequestException(
        'Facebook Messenger recipient identity is invalid.',
      );
    }
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(derived)) {
      throw new BadRequestException(
        'Facebook Messenger recipient identity is invalid.',
      );
    }
    const pageId = this.resolvePageId(channel);
    if (derived === pageId || derived === channel.externalAccountId) {
      throw new BadRequestException(
        'Facebook Messenger recipient identity is invalid.',
      );
    }
    return derived;
  }

  private async assertStandardMessagingWindow(
    channel: InboxChannelEntity,
    conversation: InboxConversationEntity,
  ) {
    const lastInbound = await this.messagesRepository.findOne({
      where: {
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        direction: 'inbound',
      },
      select: { id: true, occurredAt: true },
      order: { occurredAt: 'DESC' },
    });
    const insideWindow =
      lastInbound !== null &&
      Date.now() - lastInbound.occurredAt.getTime() <
        STANDARD_MESSAGING_WINDOW_MS;
    if (!insideWindow) {
      throw new ConflictException(FACEBOOK_MESSENGER_WINDOW_CLOSED);
    }
  }

  private assertActorCanSend(
    conversation: InboxConversationEntity,
    actor: MessengerTextActor,
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
  }

  private async assertGovernedReply(
    channel: InboxChannelEntity,
    conversation: InboxConversationEntity,
    input: SendMessengerTextInput,
    actor: Extract<MessengerTextActor, { type: 'agent' }>,
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
        input.idempotencyKey,
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

  private async sendToMeta(
    channel: InboxChannelEntity,
    accessToken: string,
    body: Record<string, unknown>,
  ) {
    const version = process.env.META_GRAPH_API_VERSION ?? 'v24.0';
    const pageId = this.resolvePageId(channel);
    if (!pageId) {
      throw new BadRequestException(
        'Facebook Messenger provider identity is not configured.',
      );
    }
    const response = await fetch(
      `https://graph.facebook.com/${version}/${pageId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    const responsePayload: unknown = await response.json().catch(() => ({}));
    const data: MessengerSendResponse = this.isRecord(responsePayload)
      ? responsePayload
      : {};
    if (!response.ok || data.error) {
      const graphError = this.isRecord(data.error) ? data.error : null;
      const nestedSubcode = graphError?.error_subcode;
      const topLevelSubcode = data.error_subcode;

      this.logger.error('Meta Messenger outbound failed', {
        operation: 'sendFacebookMessengerMessage',
        status: response.status,
        type: typeof graphError?.type === 'string' ? graphError.type : null,
        code: typeof graphError?.code === 'number' ? graphError.code : null,
        subcode:
          typeof nestedSubcode === 'number'
            ? nestedSubcode
            : typeof topLevelSubcode === 'number'
              ? topLevelSubcode
              : null,
        message: this.sanitizeMetaOutboundErrorMessage(graphError?.message, [
          accessToken,
          pageId,
          this.readRecipientId(body),
          process.env.META_APP_SECRET,
          process.env.META_INSTAGRAM_APP_SECRET,
        ]),
      });

      throw new BadRequestException(
        'Não foi possível enviar pelo canal Messenger.',
      );
    }
    return data;
  }

  private resolvePageId(channel: InboxChannelEntity) {
    return channel.externalPageId?.trim() || channel.externalAccountId?.trim();
  }

  private readRecipientId(body: Record<string, unknown>) {
    const recipient = this.isRecord(body.recipient) ? body.recipient : null;
    return typeof recipient?.id === 'string' ? recipient.id : undefined;
  }

  private sanitizeMetaOutboundErrorMessage(
    value: unknown,
    sensitiveValues: ReadonlyArray<string | undefined>,
  ): string | null {
    if (typeof value !== 'string') return null;

    let sanitized = value.replace(/https?:\/\/\S+/gi, '[REDACTED_URL]');
    sanitized = sanitized.replace(
      /\b(?:authorization|(?:page[\s_-]*|instagram[\s_-]*|user[\s_-]*)?access[\s_-]*token|app[\s_-]*secret|client[\s_-]*secret|oauth[\s_-]*code|authorization[\s_-]*code|credentialsEncrypted|recipient(?:[\s_-]*id)?|channel[\s_-]*id|conversation[\s_-]*id|fbtrace[\s_-]*id)\s*(?::|=|\s)\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)[,;]?/gi,
      '[REDACTED]',
    );
    sanitized = sanitized.replace(
      /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
      '[REDACTED]',
    );

    for (const sensitiveValue of sensitiveValues) {
      const normalizedValue = sensitiveValue?.trim();
      if (normalizedValue) {
        sanitized = sanitized.split(normalizedValue).join('[REDACTED]');
      }
    }

    return sanitized.replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async completeMessage(input: {
    channel: InboxChannelEntity;
    conversation: InboxConversationEntity;
    message: InboxMessageEntity;
    externalMessageId: string | null;
    preview: string;
    actor: MessengerTextActor;
  }) {
    const sentAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      input.message.externalMessageId = input.externalMessageId;
      input.message.status = 'sent';
      input.message.sentAt = sentAt;
      await manager.getRepository(InboxMessageEntity).save(input.message);
      input.conversation.lastMessagePreview = input.preview.slice(0, 260);
      input.conversation.lastMessageAt = sentAt;
      if (input.conversation.status === 'new')
        input.conversation.status = 'open';
      await manager
        .getRepository(InboxConversationEntity)
        .save(input.conversation);
      await manager.getRepository(InboxConversationEventEntity).save({
        tenantId: input.channel.tenantId,
        workspaceId: input.channel.workspaceId,
        conversationId: input.conversation.id,
        eventType: 'message_sent',
        actorType: input.actor.type === 'agent' ? 'agent' : 'user',
        actorUserId:
          input.actor.type === 'user' ? input.message.senderUserId : null,
        payload: {
          messageId: input.message.id,
          externalMessageId: input.externalMessageId,
          channelId: input.channel.id,
          channelType: 'facebook_messenger',
          provider: 'meta',
        },
      });
      await manager.getRepository(InboxDomainOutboxEntity).save({
        tenantId: input.channel.tenantId,
        workspaceId: input.channel.workspaceId,
        aggregateType: 'inbox_conversation',
        aggregateId: input.conversation.id,
        eventName: 'leadflow.inbox.conversation.message.sent',
        eventVersion: 1,
        idempotencyKey: `message.sent:${input.message.id}`,
        payload: {
          conversationId: input.conversation.id,
          contactId: input.conversation.contactId,
          messageId: input.message.id,
          messageType: input.message.messageType,
          authorType: input.actor.type,
        },
        publishedAt: null,
      });
    });
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

  private async failMessage(message: InboxMessageEntity) {
    message.status = 'failed';
    message.metadata = {
      ...message.metadata,
      errorCode: 'provider_send_failed',
    };
    await this.messagesRepository.save(message);
  }

  private resolveMediaType(mimeType: string): MessengerMediaType {
    const normalized = mimeType.toLowerCase();
    if (normalized.startsWith('image/')) return 'image';
    if (normalized.startsWith('audio/')) return 'audio';
    if (normalized.startsWith('video/')) return 'video';
    return 'file';
  }

  private recipientAuthorization(recipient: string) {
    return {
      canonicalE164: `facebook_messenger:${recipient}`,
      transportRecipient: recipient,
      recipientHash: createHash('sha256').update(recipient).digest('hex'),
      recipientMasked: `fbm:${recipient.slice(-8)}`,
    };
  }

  private absoluteAssetUrl(path: string) {
    const base =
      process.env.API_PUBLIC_URL?.trim() ||
      process.env.AGENCY_PUBLIC_API_URL?.trim() ||
      process.env.META_WEBHOOK_CALLBACK_URL?.trim();
    if (!base) {
      throw new BadRequestException(
        'Public API URL is not configured for media.',
      );
    }
    return new URL(path, base).toString();
  }

  private requireWorkspaceId(ctx: RequestContext) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    return ctx.workspaceId;
  }

  private channelMatchesContext(
    ctx: RequestContext,
    channel: InboxChannelEntity,
  ) {
    const managedContext = ctx.managedContext;
    const metadata = channel.metadata ?? {};
    if (managedContext?.operatingMode === 'client') {
      return metadata.clientId === managedContext.clientId;
    }
    return metadata.clientId == null || metadata.operatingMode === 'agency';
  }
}
