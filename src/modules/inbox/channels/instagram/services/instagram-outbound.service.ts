import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { InboxMetaOperationLedgerService } from '../../whatsapp/services/inbox-meta-operation-ledger.service';
import { InstagramAudioNormalizerService } from './instagram-audio-normalizer.service';

type SendInstagramTextInput = {
  ctx: RequestContext;
  channelId: string;
  conversationId: string;
  to: string;
  text: string;
  replyToMessageId?: string;
  idempotencyKey?: string;
};

type SendInstagramAgentTextInput = SendInstagramTextInput & {
  idempotencyKey: string;
  agentId: string;
  ownershipVersion: number;
  decisionId: string;
  policyVersion: string;
};

type InstagramTextActor =
  | { type: 'user' }
  | {
      type: 'agent';
      agentId: string;
      ownershipVersion: number;
      decisionId: string;
      policyVersion: string;
    };

type InstagramMediaType = 'audio' | 'image' | 'video';

type SendInstagramMediaInput = {
  ctx: RequestContext;
  channelId: string;
  conversationId: string;
  to: string;
  file: Express.Multer.File;
  caption?: string;
  idempotencyKey?: string;
};

type InstagramSendResponse = {
  recipient_id?: string;
  message_id?: string;
  error?: { message?: string; code?: number; error_subcode?: number };
};

@Injectable()
export class InstagramOutboundService {
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
    private readonly audioNormalizer: InstagramAudioNormalizerService,
  ) {}

  async sendText(input: SendInstagramTextInput) {
    return this.sendTextForActor(input, { type: 'user' });
  }

  async sendAgentText(input: SendInstagramAgentTextInput) {
    return this.sendTextForActor(input, {
      type: 'agent',
      agentId: input.agentId,
      ownershipVersion: input.ownershipVersion,
      decisionId: input.decisionId,
      policyVersion: input.policyVersion,
    });
  }

  private async sendTextForActor(
    input: SendInstagramTextInput,
    actor: InstagramTextActor,
  ) {
    const { channel, conversation, accessToken, recipient } =
      await this.resolveSendContext(input);
    this.assertActorCanSend(conversation, actor);
    if (actor.type === 'agent') {
      await this.assertGovernedReply(channel, conversation, input, actor);
    }

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
        operation: 'instagram_send_text',
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
        content: input.text.trim(),
        status: 'pending',
        attachments: [],
        metadata: {
          provider: 'meta',
          channelType: 'instagram',
          ...(replyTarget
            ? {
                replyToMessageId: replyTarget.id,
                replyToPreview: replyTarget.content.slice(0, 160),
                nativeReplySupported: false,
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
      operation: 'instagram_send_text',
      idempotencyKey,
      recipient: recipientAuthorization,
    });
    const startedMs = Date.now();
    let response: InstagramSendResponse;
    try {
      await this.metaLedger.started(ledger);
      response = await this.sendToMeta(channel, accessToken, {
        recipient: { id: recipient },
        message: { text: input.text.trim() },
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
      preview: input.text.trim(),
      actor,
    });
    return { conversation, message, meta: response };
  }

  async sendMedia(input: SendInstagramMediaInput) {
    if (!input.file) throw new BadRequestException('Arquivo não enviado.');
    const mediaType = this.resolveMediaType(input.file.mimetype);
    const { channel, conversation, accessToken, recipient } =
      await this.resolveSendContext(input);
    this.assertActorCanSend(conversation, { type: 'user' });

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
        operation: 'instagram_send_media',
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
      maxBytes: 10 * 1024 * 1024,
    });
    const mediaUrl = this.absoluteAssetUrl(stored.url);
    const caption = input.caption?.trim() || '';
    const label = `[${mediaType === 'image' ? 'imagem' : mediaType === 'audio' ? 'áudio' : 'vídeo'}]`;
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
          channelType: 'instagram',
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
      operation: 'instagram_send_media',
      idempotencyKey,
      recipient: recipientAuthorization,
    });
    const startedMs = Date.now();
    let response: InstagramSendResponse;
    try {
      await this.metaLedger.started(ledger);
      response = await this.sendToMeta(channel, accessToken, {
        recipient: { id: recipient },
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

  async deliverReaction(input: {
    conversation: InboxConversationEntity;
    message: InboxMessageEntity;
    emoji: string;
  }): Promise<boolean> {
    const channelId = input.message.channelId ?? input.conversation.channelId;
    const externalMessageId = input.message.externalMessageId;
    if (!channelId || !externalMessageId) return false;
    if (input.emoji && !['❤', '❤️'].includes(input.emoji)) return false;

    const channel = await this.channelsRepository.findOne({
      where: {
        id: channelId,
        tenantId: input.conversation.tenantId,
        workspaceId: input.conversation.workspaceId,
        type: 'instagram',
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
      input.conversation.externalThreadId,
      input.conversation.metadata,
    );
    const payload: Record<string, unknown> = {
      recipient: { id: recipient },
      sender_action: input.emoji ? 'react' : 'unreact',
      payload: {
        message_id: externalMessageId,
        ...(input.emoji ? { reaction: 'love' } : {}),
      },
    };
    await this.sendToMeta(channel, accessToken, payload);
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
        type: 'instagram',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
    });
    if (
      !channel ||
      !channel.externalAccountId ||
      !this.channelMatchesContext(input.ctx, channel)
    ) {
      throw new NotFoundException('Active Instagram Meta channel not found.');
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
        'Instagram access token is not configured.',
      );
    }
    const recipient = this.resolveRecipient(
      input.to,
      conversation.externalThreadId,
      conversation.metadata,
    );
    return { channel, conversation, accessToken, recipient };
  }

  private resolveRecipient(
    requested: string,
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
      (threadId.startsWith('instagram:')
        ? (threadId.split(':').at(-1) ?? '')
        : threadId);
    const suppliedRaw = requested.trim();
    // Governed AI actions carry the canonical conversation thread, while UI
    // sends carry the scoped recipient directly. Both must resolve to the same
    // participant before a request is allowed out.
    const supplied = suppliedRaw === threadId ? derived : suppliedRaw;
    if (!derived || (supplied && supplied !== derived)) {
      throw new BadRequestException('Instagram recipient identity is invalid.');
    }
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(derived)) {
      throw new BadRequestException('Instagram recipient identity is invalid.');
    }
    return derived;
  }

  private assertActorCanSend(
    conversation: InboxConversationEntity,
    actor: InstagramTextActor,
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
    input: SendInstagramTextInput,
    actor: Extract<InstagramTextActor, { type: 'agent' }>,
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
    const response = await fetch(
      `https://graph.instagram.com/${version}/${channel.externalAccountId}/messages`,
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
    const data = (await response
      .json()
      .catch(() => ({}))) as InstagramSendResponse;
    if (!response.ok || data.error) {
      throw new BadRequestException(
        'Não foi possível enviar pelo canal Instagram.',
      );
    }
    return data;
  }

  private async completeMessage(input: {
    channel: InboxChannelEntity;
    conversation: InboxConversationEntity;
    message: InboxMessageEntity;
    externalMessageId: string | null;
    preview: string;
    actor: InstagramTextActor;
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
          channelType: 'instagram',
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

  private resolveMediaType(mimeType: string): InstagramMediaType {
    const normalized = mimeType.toLowerCase();
    if (normalized.startsWith('image/')) return 'image';
    if (normalized.startsWith('audio/')) return 'audio';
    if (normalized.startsWith('video/')) return 'video';
    throw new BadRequestException(
      'O Instagram aceita imagens, áudios e vídeos neste envio.',
    );
  }

  private recipientAuthorization(recipient: string) {
    return {
      canonicalE164: `instagram:${recipient}`,
      transportRecipient: recipient,
      recipientHash: createHash('sha256').update(recipient).digest('hex'),
      recipientMasked: `ig:${recipient.slice(-8)}`,
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
