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
import { inboxEntityMatchesScope } from '../../../inbox-company-scope';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { AssetAccessService } from '../../../../../common/files/asset-access.service';
import { assertInboxMediaSize } from '../../../inbox-media-limits';
import { FilesService } from '../../../../../common/files/files.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../../../entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../../../entities/inbox-message.entity';
import { InstagramAudioNormalizerService } from '../../instagram/services/instagram-audio-normalizer.service';
import { InboxMetaOperationLedgerService } from '../../whatsapp/services/inbox-meta-operation-ledger.service';
import {
  HUMAN_AGENT_TAG_REQUIRES_HUMAN,
  evaluateMetaWindow,
  loadMetaMessagingWindow,
  type MetaWindowActor,
} from '../../meta/meta-messaging-window';
import {
  assertAutomationSendConfirmed,
  inboxScopeRequestContext,
  isHumanActor,
  metaActorAuthorType,
  metaActorMessageMetadata,
  metaActorOutboxFields,
  assertFollowUpSendable,
  type MetaTextActor,
  type SendMetaAutomationMessageInput,
  type SendMetaFollowUpTextInput,
} from '../../meta/meta-outbound-commands';

/**
 * Refusal for a send outside the Messenger window. A business may reply for
 * 24 hours after the contact's last message; past that only a person may answer
 * with `HUMAN_AGENT` (D-IX-3), up to seven days. The window is resolved in
 * `meta-messaging-window.ts`, shared with Instagram and the follow-up; Utility
 * and Marketing Messages stay out (D-IX-10).
 */
export const FACEBOOK_MESSENGER_WINDOW_CLOSED =
  'facebook_messenger_outside_standard_messaging_window';

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

type MessengerTextActor = MetaTextActor;

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
    private readonly assetAccess: AssetAccessService,
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

  /**
   * Canonical Messenger command for a governed automation (the D+0/D+1
   * follow-up). Text only, inside the standard window only.
   */
  async sendAutomationMessage(input: SendMetaAutomationMessageInput) {
    const conversation = await this.conversationsRepository.findOne({
      where: {
        id: input.conversationId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
      },
    });
    if (
      !conversation ||
      !conversation.channelId ||
      !conversation.externalThreadId
    ) {
      throw new NotFoundException(
        'Facebook Messenger conversation not found for automation.',
      );
    }
    if (input.connectionRef && conversation.channelId !== input.connectionRef) {
      throw new NotFoundException(
        'Configured Messenger connection is not the conversation channel.',
      );
    }
    const text = input.text?.trim() ?? '';
    if (!text) {
      throw new BadRequestException('Messenger automation text is required.');
    }
    const result = await this.sendTextForActor(
      {
        ctx: inboxScopeRequestContext(conversation),
        channelId: conversation.channelId,
        conversationId: conversation.id,
        to: conversation.externalThreadId,
        text,
        idempotencyKey: input.idempotencyKey,
      },
      { type: 'automation', automationId: input.automationId },
    );
    assertAutomationSendConfirmed(result.message);
    return result;
  }

  /** A person answering a pending follow-up, without taking the conversation. */
  async sendFollowUpText(input: SendMetaFollowUpTextInput) {
    const conversation = await this.conversationsRepository.findOne({
      where: {
        id: input.conversationId,
        tenantId: input.ctx.tenantId,
        workspaceId: this.requireWorkspaceId(input.ctx),
      },
    });
    if (
      !conversation ||
      !conversation.channelId ||
      !conversation.externalThreadId
    ) {
      throw new NotFoundException('Inbox conversation not found.');
    }
    return this.sendTextForActor(
      {
        ctx: input.ctx,
        channelId: conversation.channelId,
        conversationId: conversation.id,
        to: conversation.externalThreadId,
        text: input.text,
        idempotencyKey: input.idempotencyKey,
      },
      {
        type: 'followup',
        automationId: input.automationId,
        stepKey: input.stepKey,
        userId: input.ctx.userId ?? null,
      },
    );
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
    const tag = await this.resolveWindowTag(
      channel,
      conversation,
      isHumanActor(actor) ? 'human' : 'automated',
    );

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
        senderType:
          actor.type === 'automation'
            ? 'system'
            : actor.type === 'agent'
              ? 'agent'
              : 'user',
        senderUserId: isHumanActor(actor) ? (input.ctx.userId ?? null) : null,
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
          ...metaActorMessageMetadata(actor, tag),
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
        ...messagingTypeFields(tag),
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
    const maxBytes = assertInboxMediaSize(
      'facebook_messenger',
      mediaType,
      input.file,
    );
    const { channel, conversation, accessToken, recipient } =
      await this.resolveSendContext(input);
    this.assertActorCanSend(conversation, { type: 'user' });
    const tag = await this.resolveWindowTag(channel, conversation, 'human');

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
    assertInboxMediaSize('facebook_messenger', mediaType, mediaFile);
    const ext = mediaFile.originalname.split('.').pop()?.toLowerCase() ?? 'bin';
    const stored = await this.filesService.uploadRawFile({
      file: mediaFile,
      path: `tenants/${channel.tenantId}/workspaces/${channel.workspaceId}/inbox/attachments/${Date.now()}-${randomUUID()}.${ext}`,
      maxBytes,
    });
    // Meta fetches the attachment from this URL, so it must be the public API
    // origin — the storage path alone is not reachable from Meta's servers.
    const mediaUrl = `${this.absoluteAssetUrl(stored.url)}?${this.assetAccess.issueGrant(stored.path, 'provider:meta', 3600).query}`;
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
          ...(tag ? { messageTag: tag } : {}),
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
        ...messagingTypeFields(tag),
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

  /**
   * Applies the shared window: no tag inside it, `HUMAN_AGENT` for a person
   * past it, and a refusal that names the reason otherwise.
   */
  private async resolveWindowTag(
    channel: InboxChannelEntity,
    conversation: InboxConversationEntity,
    actor: MetaWindowActor,
  ): Promise<'HUMAN_AGENT' | null> {
    const window = await loadMetaMessagingWindow({
      messages: this.messagesRepository,
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      conversationId: conversation.id,
    });
    const verdict = evaluateMetaWindow(window, actor);
    if (!verdict.allowed) {
      throw new ConflictException(
        verdict.reason === HUMAN_AGENT_TAG_REQUIRES_HUMAN
          ? HUMAN_AGENT_TAG_REQUIRES_HUMAN
          : FACEBOOK_MESSENGER_WINDOW_CLOSED,
      );
    }
    return verdict.tag;
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
    if (
      actor.type === 'automation' &&
      (conversation.ownershipState !== 'ai_active' || !conversation.aiEnabled)
    ) {
      throw new ConflictException(
        'Automatic message blocked by current conversation ownership.',
      );
    }
    if (actor.type === 'followup') assertFollowUpSendable(conversation, actor);
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
      // Same lock key as InboundMessageIngestionService.ingest()/ingestEcho():
      // serializes this mid write against any concurrent inbound/echo
      // processing for the thread, so a fast echo can never be dedup-checked
      // before our own send finishes recording its externalMessageId.
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [
          `${input.channel.tenantId}:${input.channel.workspaceId}:${input.channel.id}:${input.conversation.externalThreadId}`,
        ],
      );
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
        actorType: metaActorAuthorType(input.actor),
        actorUserId: isHumanActor(input.actor)
          ? input.message.senderUserId
          : null,
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
          authorType: metaActorAuthorType(input.actor),
          ...metaActorOutboxFields(input.actor),
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
    return inboxEntityMatchesScope(ctx, channel);
  }
}

/**
 * Messenger always states why it is writing: `RESPONSE` inside the window,
 * `MESSAGE_TAG` + `HUMAN_AGENT` when a person answers past it.
 */
function messagingTypeFields(
  tag: 'HUMAN_AGENT' | null,
): Record<string, string> {
  return tag
    ? { messaging_type: 'MESSAGE_TAG', tag }
    : { messaging_type: 'RESPONSE' };
}
