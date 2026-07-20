import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { FilesService } from '../../../../../common/files/files.service';
import type { RequestContext } from '../../../../../common/context/request-context.interface';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../../entities/inbox-conversation-event.entity';
import { InboxMessageEntity } from '../../../entities/inbox-message.entity';
import { InboxDomainOutboxEntity } from '../../../entities/inbox-domain-outbox.entity';

type SendWhatsAppTextInput = {
  ctx: RequestContext;
  channelId: string;
  conversationId?: string;
  to: string;
  text: string;
  idempotencyKey?: string;
};

type SendWhatsAppMediaInput = {
  ctx: RequestContext;
  channelId: string;
  conversationId?: string;
  to: string;
  file: Express.Multer.File;
  caption?: string;
  idempotencyKey?: string;
};

type WhatsAppMediaType = 'audio' | 'image' | 'video' | 'document';

const WHATSAPP_MEDIA_LABELS: Record<WhatsAppMediaType, string> = {
  audio: 'áudio',
  image: 'imagem',
  video: 'vídeo',
  document: 'documento',
};

function resolveWhatsAppMediaType(mimeType: string): WhatsAppMediaType {
  const normalized = (mimeType || '').toLowerCase();
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  return 'document';
}

type MetaSendMessageResponse = {
  messaging_product?: string;
  contacts?: Array<{
    input?: string;
    wa_id?: string;
  }>;
  messages?: Array<{
    id?: string;
    message_status?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

@Injectable()
export class WhatsAppOutboundService {
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
  ) {}

  async sendText(input: SendWhatsAppTextInput) {
    const channel = await this.findChannelForContext(
      input.ctx,
      input.channelId,
    );

    if (!channel) {
      throw new NotFoundException('Active WhatsApp Meta channel not found.');
    }

    if (!channel.externalPhoneNumberId) {
      throw new BadRequestException(
        'WhatsApp phone number ID is not configured.',
      );
    }

    const accessToken = this.cryptoService.decrypt(
      channel.accessTokenEncrypted,
    );

    if (!accessToken) {
      throw new BadRequestException('WhatsApp access token is not configured.');
    }

    const conversation = input.conversationId
      ? await this.findConversation(input.ctx, channel, input.conversationId)
      : await this.findOrCreateConversation(
          channel,
          input.to,
          input.ctx.userId ?? null,
        );

    if (conversation.ownershipState !== 'human_active') {
      throw new ConflictException(
        'A user must assume the conversation before replying through its channel.',
      );
    }

    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const existing = await this.messagesRepository.findOne({
      where: {
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        idempotencyKey,
      },
    });
    if (existing) {
      return { conversation, message: existing, meta: {} };
    }

    const now = new Date();
    const message = await this.messagesRepository.save(
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
        messageType: 'text',
        content: input.text,
        status: 'pending',
        attachments: [],
        metadata: { provider: 'meta', channelType: 'whatsapp' },
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        occurredAt: now,
        providerSequence: null,
      }),
    );

    let response: MetaSendMessageResponse;
    try {
      response = await this.sendToMeta({
        phoneNumberId: channel.externalPhoneNumberId,
        accessToken,
        to: input.to,
        text: input.text,
      });
    } catch (error) {
      message.status = 'failed';
      message.metadata = {
        ...message.metadata,
        errorCode: 'provider_send_failed',
      };
      await this.messagesRepository.save(message);
      throw error;
    }

    const externalMessageId = response.messages?.[0]?.id ?? null;
    await this.dataSource.transaction(async (manager) => {
      message.externalMessageId = externalMessageId;
      message.status = 'sent';
      message.sentAt = new Date();
      await manager.getRepository(InboxMessageEntity).save(message);

      conversation.lastMessagePreview = input.text.trim().slice(0, 260);
      conversation.lastMessageAt = message.sentAt;
      await manager.getRepository(InboxConversationEntity).save(conversation);

      await manager.getRepository(InboxConversationEventEntity).save({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        eventType: 'message_sent',
        actorType: input.ctx.userId ? 'user' : 'system',
        actorUserId: input.ctx.userId ?? null,
        payload: {
          messageId: message.id,
          externalMessageId,
          channelId: channel.id,
          channelType: 'whatsapp',
          provider: 'meta',
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
          messageType: 'text',
        },
        publishedAt: null,
      });
    });

    return {
      conversation,
      message,
      meta: response,
    };
  }

  async sendMedia(input: SendWhatsAppMediaInput) {
    if (!input.file) {
      throw new BadRequestException('Arquivo não enviado.');
    }

    const channel = await this.findChannelForContext(
      input.ctx,
      input.channelId,
    );

    if (!channel) {
      throw new NotFoundException('Active WhatsApp Meta channel not found.');
    }

    if (!channel.externalPhoneNumberId) {
      throw new BadRequestException(
        'WhatsApp phone number ID is not configured.',
      );
    }

    const accessToken = this.cryptoService.decrypt(
      channel.accessTokenEncrypted,
    );

    if (!accessToken) {
      throw new BadRequestException('WhatsApp access token is not configured.');
    }

    const conversation = input.conversationId
      ? await this.findConversation(input.ctx, channel, input.conversationId)
      : await this.findOrCreateConversation(
          channel,
          input.to,
          input.ctx.userId ?? null,
        );

    if (conversation.ownershipState !== 'human_active') {
      throw new ConflictException(
        'A user must assume the conversation before replying through its channel.',
      );
    }

    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const existing = await this.messagesRepository.findOne({
      where: {
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        idempotencyKey,
      },
    });
    if (existing) {
      return { conversation, message: existing, meta: {} };
    }

    const mediaType = resolveWhatsAppMediaType(input.file.mimetype);
    const caption = input.caption?.trim() || '';
    const ext = input.file.originalname.split('.').pop()?.toLowerCase() ?? 'bin';

    // Guarda a cópia no nosso storage para renderizar o balão outbound.
    const storagePath = `tenants/${channel.tenantId}/workspaces/${channel.workspaceId}/inbox/attachments/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;
    const stored = await this.filesService.uploadRawFile({
      file: input.file,
      path: storagePath,
    });

    const now = new Date();
    const message = await this.messagesRepository.save(
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
        content: caption || input.file.originalname,
        status: 'pending',
        attachments: [
          {
            url: stored.url,
            path: stored.path,
            name: input.file.originalname,
            mimeType: input.file.mimetype,
            size: input.file.size,
            kind: mediaType,
          },
        ],
        metadata: {
          provider: 'meta',
          channelType: 'whatsapp',
          mediaUrl: stored.url,
          attachmentUrl: stored.url,
          mimeType: input.file.mimetype,
          fileName: input.file.originalname,
          fileSize: input.file.size,
        },
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        occurredAt: now,
        providerSequence: null,
      }),
    );

    let response: MetaSendMessageResponse;
    try {
      const mediaId = await this.uploadMediaToMeta({
        phoneNumberId: channel.externalPhoneNumberId,
        accessToken,
        file: input.file,
      });
      response = await this.sendMediaToMeta({
        phoneNumberId: channel.externalPhoneNumberId,
        accessToken,
        to: input.to,
        mediaType,
        mediaId,
        caption,
        filename: input.file.originalname,
      });
    } catch (error) {
      message.status = 'failed';
      message.metadata = {
        ...message.metadata,
        errorCode: 'provider_send_failed',
      };
      await this.messagesRepository.save(message);
      throw error;
    }

    const externalMessageId = response.messages?.[0]?.id ?? null;
    const preview = caption || `[${WHATSAPP_MEDIA_LABELS[mediaType]}]`;
    await this.dataSource.transaction(async (manager) => {
      message.externalMessageId = externalMessageId;
      message.status = 'sent';
      message.sentAt = new Date();
      await manager.getRepository(InboxMessageEntity).save(message);

      conversation.lastMessagePreview = preview.slice(0, 260);
      conversation.lastMessageAt = message.sentAt;
      await manager.getRepository(InboxConversationEntity).save(conversation);

      await manager.getRepository(InboxConversationEventEntity).save({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        eventType: 'message_sent',
        actorType: input.ctx.userId ? 'user' : 'system',
        actorUserId: input.ctx.userId ?? null,
        payload: {
          messageId: message.id,
          externalMessageId,
          channelId: channel.id,
          channelType: 'whatsapp',
          provider: 'meta',
          mediaType,
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
          messageType: 'media',
        },
        publishedAt: null,
      });
    });

    return {
      conversation,
      message,
      meta: response,
    };
  }

  private async findConversation(
    ctx: RequestContext,
    channel: InboxChannelEntity,
    conversationId: string,
  ) {
    const conversation = await this.conversationsRepository.findOne({
      where: {
        id: conversationId,
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
      },
    });

    if (!conversation || !this.channelMatchesContext(ctx, channel)) {
      throw new NotFoundException('Inbox conversation not found for channel.');
    }

    return conversation;
  }

  private async findChannelForContext(ctx: RequestContext, channelId: string) {
    const channel = await this.channelsRepository.findOne({
      where: {
        id: channelId,
        tenantId: ctx.tenantId,
        workspaceId: this.requireWorkspaceId(ctx),
        type: 'whatsapp',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
    });

    if (!channel || !this.channelMatchesContext(ctx, channel)) {
      throw new NotFoundException('Active WhatsApp Meta channel not found.');
    }

    return channel;
  }

  private channelMatchesContext(
    ctx: RequestContext,
    channel: InboxChannelEntity,
  ) {
    const managedContext = ctx.managedContext;
    const metadata = channel.metadata ?? {};
    const clientId =
      typeof metadata.clientId === 'string' ? metadata.clientId : null;
    const operatingMode =
      typeof metadata.operatingMode === 'string'
        ? metadata.operatingMode
        : null;

    if (managedContext?.operatingMode === 'client') {
      return clientId === managedContext.clientId;
    }

    return !clientId || operatingMode === 'agency';
  }

  private requireWorkspaceId(ctx: RequestContext) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    return ctx.workspaceId;
  }

  private async findOrCreateConversation(
    channel: InboxChannelEntity,
    externalThreadId: string,
    userId: string | null,
  ) {
    const existing = await this.conversationsRepository.findOne({
      where: {
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        externalThreadId,
      },
    });

    if (existing) return existing;

    return this.conversationsRepository.save(
      this.conversationsRepository.create({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        contactId: null,
        opportunityId: null,
        externalThreadId,
        title: externalThreadId,
        status: 'new',
        priority: 'normal',
        assignedUserId: userId,
        assignedAgentId: null,
        source: 'whatsapp',
        businessMode: 'general',
        lastMessagePreview: null,
        lastMessageAt: null,
        unreadCount: 0,
        aiEnabled: false,
        ownershipState: 'human_active',
        ownershipVersion: 1,
        ownershipReason: 'human_outbound_started',
        ownershipChangedAt: new Date(),
        qualificationStatus: 'pending',
        qualificationReason: null,
        closedAt: null,
        archivedAt: null,
        metadata: {
          provider: 'meta',
          channelType: 'whatsapp',
        },
      }),
    );
  }

  private async sendToMeta(input: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    text: string;
  }): Promise<MetaSendMessageResponse> {
    const graphVersion = process.env.META_GRAPH_API_VERSION ?? 'v24.0';
    const url = `https://graph.facebook.com/${graphVersion}/${input.phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'text',
        text: {
          preview_url: false,
          body: input.text,
        },
      }),
    });

    const data = (await response.json()) as MetaSendMessageResponse;

    if (!response.ok || data.error) {
      throw new BadRequestException(
        'Não foi possível enviar a mensagem pelo canal WhatsApp.',
      );
    }

    return data;
  }

  private async uploadMediaToMeta(input: {
    phoneNumberId: string;
    accessToken: string;
    file: Express.Multer.File;
  }): Promise<string> {
    const graphVersion = process.env.META_GRAPH_API_VERSION ?? 'v24.0';
    const url = `https://graph.facebook.com/${graphVersion}/${input.phoneNumberId}/media`;

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', input.file.mimetype);
    form.append(
      'file',
      new Blob([new Uint8Array(input.file.buffer)], {
        type: input.file.mimetype,
      }),
      input.file.originalname,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}` },
      body: form,
    });

    const data = (await response.json()) as { id?: string; error?: unknown };

    if (!response.ok || !data.id) {
      throw new BadRequestException(
        'Não foi possível enviar a mídia ao canal WhatsApp.',
      );
    }

    return data.id;
  }

  private async sendMediaToMeta(input: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    mediaType: WhatsAppMediaType;
    mediaId: string;
    caption: string;
    filename: string;
  }): Promise<MetaSendMessageResponse> {
    const graphVersion = process.env.META_GRAPH_API_VERSION ?? 'v24.0';
    const url = `https://graph.facebook.com/${graphVersion}/${input.phoneNumberId}/messages`;

    const mediaPayload: Record<string, string> = { id: input.mediaId };
    // Áudio não aceita legenda; documento usa filename (e legenda opcional).
    if (input.mediaType === 'document') {
      mediaPayload.filename = input.filename;
      if (input.caption) mediaPayload.caption = input.caption;
    } else if (input.mediaType !== 'audio' && input.caption) {
      mediaPayload.caption = input.caption;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: input.mediaType,
        [input.mediaType]: mediaPayload,
      }),
    });

    const data = (await response.json()) as MetaSendMessageResponse;

    if (!response.ok || data.error) {
      throw new BadRequestException(
        'Não foi possível enviar a mídia pelo canal WhatsApp.',
      );
    }

    return data;
  }
}
