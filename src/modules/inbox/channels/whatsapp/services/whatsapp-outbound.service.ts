import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import ffmpegStatic from 'ffmpeg-static';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { FilesService } from '../../../../../common/files/files.service';
import type { RequestContext } from '../../../../../common/context/request-context.interface';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../../entities/inbox-conversation-event.entity';
import { InboxMessageEntity } from '../../../entities/inbox-message.entity';
import { InboxDomainOutboxEntity } from '../../../entities/inbox-domain-outbox.entity';
import { InboxPilotOutboundPolicyService } from './inbox-pilot-outbound-policy.service';
import { InboxMetaOperationLedgerService } from './inbox-meta-operation-ledger.service';

type SendWhatsAppTextInput = {
  ctx: RequestContext;
  channelId: string;
  conversationId?: string;
  to: string;
  text: string;
  replyToMessageId?: string;
  idempotencyKey?: string;
};

type SendWhatsAppAgentTextInput = SendWhatsAppTextInput & {
  conversationId: string;
  idempotencyKey: string;
  agentId: string;
  ownershipVersion: number;
  decisionId: string;
  policyVersion: string;
};

export type SendWhatsAppAutomationMessageInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  automationId: string;
  idempotencyKey: string;
  text?: string | null;
  templateRef?: string | null;
  templateLanguage?: string | null;
  /**
   * Body parameters for `{{1}}…{{n}}`, in order.
   *
   * Meta matches template variables by position, never by name, and rejects a
   * send whose parameter count differs from the approved template's. Empty means
   * a template with no variables — the only kind the platform could send before.
   */
  templateParameters?: readonly string[];
  connectionRef?: string | null;
};

export type WhatsAppAutomationTemplateErrorReason =
  | 'invalid'
  | 'language_mismatch'
  | 'components_unsupported';

export class WhatsAppAutomationTemplateError extends Error {
  constructor(readonly reason: WhatsAppAutomationTemplateErrorReason) {
    super(`whatsapp_automation_template_${reason}`);
    this.name = 'WhatsAppAutomationTemplateError';
  }
}

type WhatsAppTextActor =
  | { type: 'user' }
  | {
      type: 'agent';
      agentId: string;
      ownershipVersion: number;
      decisionId: string;
      policyVersion: string;
    }
  | {
      type: 'automation';
      automationId: string;
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

// Formatos de áudio aceitos pela Meta. Navegadores Chromium gravam
// `audio/webm;codecs=opus`, que NÃO está na lista — falhamos cedo com uma
// mensagem clara em vez de deixar a Meta rejeitar com erro genérico.
const WHATSAPP_AUDIO_MIME_TYPES = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
]);

// Vídeo: versão enxuta — só MP4 (H.264/AAC) até 16 MB, que a Meta aceita sem
// transcodificação. Outros contêineres exigiriam re-encode pesado (fica p/ depois).
const WHATSAPP_VIDEO_MIME_TYPES = new Set(['video/mp4']);
const WHATSAPP_VIDEO_MAX_BYTES = 16 * 1024 * 1024;

function getBaseMimeType(mimeType: string) {
  return (mimeType || '').toLowerCase().split(';')[0].trim();
}

const execFileAsync = promisify(execFile);

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
    private readonly outboundPolicy: InboxPilotOutboundPolicyService,
    private readonly metaLedger: InboxMetaOperationLedgerService,
  ) {}

  async sendText(input: SendWhatsAppTextInput) {
    return this.sendTextForActor(input, { type: 'user' });
  }

  async sendAgentText(input: SendWhatsAppAgentTextInput) {
    return this.sendTextForActor(input, {
      type: 'agent',
      agentId: input.agentId,
      ownershipVersion: input.ownershipVersion,
      decisionId: input.decisionId,
      policyVersion: input.policyVersion,
    });
  }

  /**
   * Canonical WhatsApp command for a governed automation.
   *
   * Free-form text is allowed only inside Meta's rolling 24-hour customer
   * service window. Outside it, the caller must provide an approved template
   * reference; the command never falls back to free-form text.
   */
  async sendAutomationMessage(input: SendWhatsAppAutomationMessageInput) {
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
        'WhatsApp conversation not found for automation.',
      );
    }
    if (input.connectionRef && conversation.channelId !== input.connectionRef) {
      throw new NotFoundException(
        'Configured WhatsApp connection is not the conversation channel.',
      );
    }
    if (
      conversation.ownershipState !== 'ai_active' ||
      !conversation.aiEnabled
    ) {
      throw new ConflictException(
        'Automatic message blocked by current conversation ownership.',
      );
    }

    const lastInbound = await this.messagesRepository.findOne({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        direction: 'inbound',
      },
      select: { id: true, occurredAt: true },
      order: { occurredAt: 'DESC' },
    });
    const insideCustomerServiceWindow =
      lastInbound !== null &&
      Date.now() - lastInbound.occurredAt.getTime() < 24 * 60 * 60 * 1_000;
    const text = input.text?.trim() ?? '';

    if (insideCustomerServiceWindow && text) {
      const result = await this.sendTextForActor(
        {
          ctx: {
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
          },
          channelId: conversation.channelId,
          conversationId: conversation.id,
          to: conversation.externalThreadId,
          text,
          idempotencyKey: input.idempotencyKey,
        },
        { type: 'automation', automationId: input.automationId },
      );
      this.assertAutomationSendConfirmed(result.message);
      return result;
    }

    const templateRef = input.templateRef?.trim() ?? '';
    if (!templateRef) {
      throw new ConflictException(
        'whatsapp_template_required_outside_customer_service_window',
      );
    }
    const result = await this.sendAutomationTemplate({
      conversation,
      templateRef,
      language: input.templateLanguage?.trim() || 'pt_BR',
      parameters: input.templateParameters ?? [],
      automationId: input.automationId,
      idempotencyKey: input.idempotencyKey,
    });
    this.assertAutomationSendConfirmed(result.message);
    return result;
  }

  private assertAutomationSendConfirmed(message: InboxMessageEntity): void {
    if (!['sent', 'delivered', 'read'].includes(message.status)) {
      // A retry may find a previous pending/failed row with the same effect
      // key. It must never reinterpret that uncertain outcome as confirmation
      // and advance the D+N sequence.
      throw new ServiceUnavailableException(
        'Automation message delivery is not confirmed.',
      );
    }
  }

  private async sendTextForActor(
    input: SendWhatsAppTextInput,
    actor: WhatsAppTextActor,
  ) {
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
    if (actor.type === 'agent') {
      const [authorization] = await this.dataSource.query<
        Array<{
          policy_outcome: string;
          status: string;
          reply_enabled: boolean;
        }>
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

    const recipient = this.outboundPolicy.authorize(
      input.to,
      conversation.externalThreadId,
    );

    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const existing = await this.messagesRepository.findOne({
      where: {
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        idempotencyKey,
      },
    });
    if (existing) {
      if (
        existing.channelId !== channel.id ||
        existing.conversationId !== conversation.id
      ) {
        throw new ConflictException('Outbound idempotency intent changed.');
      }
      await this.metaLedger.replay({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        conversationId: conversation.id,
        operation: 'send_text',
        idempotencyKey,
        recipient,
      });
      return { conversation, message: existing, meta: {} };
    }

    // Resposta citada: precisamos do `wamid` da mensagem original para a Meta
    // renderizar o balão citado no app do destinatário. Sem `wamid` (mensagem
    // interna, por exemplo) a mensagem segue normalmente, só sem citação.
    const replyTarget = input.replyToMessageId
      ? await this.messagesRepository.findOne({
          where: {
            tenantId: channel.tenantId,
            workspaceId: channel.workspaceId,
            conversationId: conversation.id,
            id: input.replyToMessageId,
          },
        })
      : null;
    const replyMetadata = replyTarget
      ? {
          replyToMessageId: replyTarget.id,
          replyToPreview: (replyTarget.content ?? '').slice(0, 160),
        }
      : {};

    const now = new Date();
    const pendingMessage = this.messagesRepository.create({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      conversationId: conversation.id,
      channelId: channel.id,
      contactId: conversation.contactId ?? null,
      direction: 'outbound',
      senderType:
        actor.type === 'agent'
          ? 'agent'
          : actor.type === 'automation'
            ? 'system'
            : 'user',
      senderUserId: actor.type === 'user' ? (input.ctx.userId ?? null) : null,
      senderAgentId: actor.type === 'agent' ? actor.agentId : null,
      externalMessageId: null,
      idempotencyKey,
      messageType: 'text',
      content: input.text,
      status: 'pending',
      attachments: [],
      metadata: {
        provider: 'meta',
        channelType: 'whatsapp',
        ...(actor.type === 'agent'
          ? {
              agentDecisionId: actor.decisionId,
              policyVersion: actor.policyVersion,
              ownershipVersion: actor.ownershipVersion,
            }
          : actor.type === 'automation'
            ? { automationId: actor.automationId }
            : {}),
        ...replyMetadata,
      },
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      occurredAt: now,
      providerSequence: null,
    });
    const textPersistence = await this.persistPendingMessage(
      pendingMessage,
      channel,
      conversation,
    );
    const message = textPersistence.message;
    if (!textPersistence.created) {
      return { conversation, message, meta: {} };
    }

    const ledger = await this.metaLedger.reserve({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      conversationId: conversation.id,
      messageId: message.id,
      operation: 'send_text',
      idempotencyKey,
      recipient,
    });
    const startedMs = Date.now();
    let response: MetaSendMessageResponse;
    try {
      await this.metaLedger.started(ledger);
      response = await this.sendToMeta({
        phoneNumberId: channel.externalPhoneNumberId,
        accessToken,
        to: recipient.transportRecipient,
        expectedTo: conversation.externalThreadId ?? input.to,
        text: input.text,
        contextMessageId: replyTarget?.externalMessageId ?? undefined,
      });
      await this.metaLedger.succeeded(
        ledger,
        startedMs,
        response.messages?.[0]?.id,
      );
    } catch (error) {
      await this.metaLedger.failed(ledger, startedMs, error);
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
      if (conversation.status === 'new') conversation.status = 'open';
      await manager.getRepository(InboxConversationEntity).save(conversation);

      await manager.getRepository(InboxConversationEventEntity).save({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        eventType: 'message_sent',
        actorType:
          actor.type === 'agent'
            ? 'agent'
            : actor.type === 'automation'
              ? 'system'
              : 'user',
        actorUserId: actor.type === 'user' ? (input.ctx.userId ?? null) : null,
        payload: {
          messageId: message.id,
          externalMessageId,
          channelId: channel.id,
          channelType: 'whatsapp',
          provider: 'meta',
          ...(actor.type === 'agent'
            ? {
                decisionId: actor.decisionId,
                policyVersion: actor.policyVersion,
              }
            : actor.type === 'automation'
              ? { automationId: actor.automationId }
              : {}),
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
          authorType:
            actor.type === 'automation'
              ? 'system'
              : actor.type === 'agent'
                ? 'agent'
                : 'user',
          ...(actor.type === 'automation'
            ? { automationId: actor.automationId }
            : {}),
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

    const recipient = this.outboundPolicy.authorize(
      input.to,
      conversation.externalThreadId,
    );

    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();
    const existing = await this.messagesRepository.findOne({
      where: {
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        idempotencyKey,
      },
    });
    if (existing) {
      if (
        existing.channelId !== channel.id ||
        existing.conversationId !== conversation.id
      ) {
        throw new ConflictException('Outbound idempotency intent changed.');
      }
      await this.metaLedger.replay({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        conversationId: conversation.id,
        operation: 'send_media',
        idempotencyKey,
        recipient,
      });
      return { conversation, message: existing, meta: {} };
    }

    const mediaType = resolveWhatsAppMediaType(input.file.mimetype);
    const caption = input.caption?.trim() || '';

    // Vídeo: só MP4 até 16 MB (sem transcodificação). Falhamos cedo com mensagem
    // clara em vez de deixar a Meta rejeitar com erro genérico.
    if (mediaType === 'video') {
      if (
        !WHATSAPP_VIDEO_MIME_TYPES.has(getBaseMimeType(input.file.mimetype))
      ) {
        throw new BadRequestException(
          'No WhatsApp só enviamos vídeos em MP4 (H.264/AAC).',
        );
      }
      if (input.file.size > WHATSAPP_VIDEO_MAX_BYTES) {
        throw new BadRequestException(
          'O vídeo excede o limite de 16 MB do WhatsApp.',
        );
      }
    }

    // Navegadores Chromium gravam `audio/webm;codecs=opus`, que a Meta recusa.
    // Como o codec já é Opus, convertemos só o container (remux, sem perda).
    let uploadBuffer = input.file.buffer;
    let uploadMimeType = input.file.mimetype;
    let uploadFilename = input.file.originalname;

    if (
      mediaType === 'audio' &&
      !WHATSAPP_AUDIO_MIME_TYPES.has(getBaseMimeType(input.file.mimetype))
    ) {
      uploadBuffer = await this.convertAudioToOggOpus(input.file);
      uploadMimeType = 'audio/ogg';
      uploadFilename = `${input.file.originalname.replace(/\.[^.]+$/, '')}.ogg`;
    }

    // Não usamos o nome do arquivo como texto da mensagem: a UI mostraria
    // "audio-123.webm" no balão. Sem legenda usamos um rótulo curto que o
    // frontend esconde e a lista aproveita como preview.
    const mediaLabel = `[${WHATSAPP_MEDIA_LABELS[mediaType]}]`;
    const messageContent = caption || mediaLabel;
    const ext =
      input.file.originalname.split('.').pop()?.toLowerCase() ?? 'bin';

    // Guarda a cópia no nosso storage para renderizar o balão outbound.
    const storagePath = `tenants/${channel.tenantId}/workspaces/${channel.workspaceId}/inbox/attachments/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;
    const stored = await this.filesService.uploadRawFile({
      file: input.file,
      path: storagePath,
      maxBytes:
        mediaType === 'video' ? WHATSAPP_VIDEO_MAX_BYTES : 10 * 1024 * 1024,
    });

    const now = new Date();
    const pendingMessage = this.messagesRepository.create({
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
      content: messageContent,
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
    });
    const mediaPersistence = await this.persistPendingMessage(
      pendingMessage,
      channel,
      conversation,
    );
    const message = mediaPersistence.message;
    if (!mediaPersistence.created) {
      return { conversation, message, meta: {} };
    }

    const ledger = await this.metaLedger.reserve({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      conversationId: conversation.id,
      messageId: message.id,
      operation: 'send_media',
      idempotencyKey,
      recipient,
    });
    const startedMs = Date.now();
    let response: MetaSendMessageResponse;
    try {
      await this.metaLedger.started(ledger);
      this.outboundPolicy.authorize(
        recipient.transportRecipient,
        conversation.externalThreadId,
      );
      const mediaId = await this.uploadMediaToMeta({
        phoneNumberId: channel.externalPhoneNumberId,
        accessToken,
        buffer: uploadBuffer,
        mimeType: uploadMimeType,
        filename: uploadFilename,
      });
      response = await this.sendMediaToMeta({
        phoneNumberId: channel.externalPhoneNumberId,
        accessToken,
        to: recipient.transportRecipient,
        expectedTo: conversation.externalThreadId ?? input.to,
        mediaType,
        mediaId,
        caption,
        filename: input.file.originalname,
      });
      await this.metaLedger.succeeded(
        ledger,
        startedMs,
        response.messages?.[0]?.id,
      );
    } catch (error) {
      await this.metaLedger.failed(ledger, startedMs, error);
      message.status = 'failed';
      message.metadata = {
        ...message.metadata,
        errorCode: 'provider_send_failed',
      };
      await this.messagesRepository.save(message);
      throw error;
    }

    const externalMessageId = response.messages?.[0]?.id ?? null;
    const preview = messageContent;
    await this.dataSource.transaction(async (manager) => {
      message.externalMessageId = externalMessageId;
      message.status = 'sent';
      message.sentAt = new Date();
      await manager.getRepository(InboxMessageEntity).save(message);

      conversation.lastMessagePreview = preview.slice(0, 260);
      conversation.lastMessageAt = message.sentAt;
      if (conversation.status === 'new') conversation.status = 'open';
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
        ? await this.messagesRepository.findOne({
            where: {
              tenantId: channel.tenantId,
              workspaceId: channel.workspaceId,
              idempotencyKey: message.idempotencyKey,
            },
          })
        : null;
      if (!raced) throw error;
      if (
        raced.channelId !== channel.id ||
        raced.conversationId !== conversation.id
      ) {
        throw new ConflictException('Outbound idempotency intent changed.');
      }
      return { message: raced, created: false };
    }
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

  private async sendAutomationTemplate(input: {
    conversation: InboxConversationEntity;
    templateRef: string;
    language: string;
    parameters: readonly string[];
    automationId: string;
    idempotencyKey: string;
  }) {
    const channel = await this.channelsRepository.findOne({
      where: {
        id: input.conversation.channelId as string,
        tenantId: input.conversation.tenantId,
        workspaceId: input.conversation.workspaceId,
        type: 'whatsapp',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
    });
    if (!channel?.externalPhoneNumberId) {
      throw new NotFoundException('Active WhatsApp Meta channel not found.');
    }
    const accessToken = this.cryptoService.decrypt(
      channel.accessTokenEncrypted,
    );
    if (!accessToken) {
      throw new BadRequestException('WhatsApp access token is not configured.');
    }
    const recipient = this.outboundPolicy.authorize(
      input.conversation.externalThreadId as string,
      input.conversation.externalThreadId,
    );

    const existing = await this.messagesRepository.findOne({
      where: {
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        idempotencyKey: input.idempotencyKey,
      },
    });
    if (existing) {
      if (
        existing.channelId !== channel.id ||
        existing.conversationId !== input.conversation.id
      ) {
        throw new ConflictException('Outbound idempotency intent changed.');
      }
      await this.metaLedger.replay({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        conversationId: input.conversation.id,
        operation: 'send_template',
        idempotencyKey: input.idempotencyKey,
        recipient,
      });
      return { conversation: input.conversation, message: existing, meta: {} };
    }

    const now = new Date();
    const pending = this.messagesRepository.create({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      conversationId: input.conversation.id,
      channelId: channel.id,
      contactId: input.conversation.contactId ?? null,
      direction: 'outbound',
      senderType: 'system',
      senderUserId: null,
      senderAgentId: null,
      externalMessageId: null,
      idempotencyKey: input.idempotencyKey,
      messageType: 'template',
      // The parameters go in the thread's own record too: without them the
      // Inbox shows `[template:x]` for a message the lead read as a sentence.
      content: input.parameters.length
        ? `[template:${input.templateRef}] ${input.parameters.join(' · ')}`
        : `[template:${input.templateRef}]`,
      status: 'pending',
      attachments: [],
      metadata: {
        provider: 'meta',
        channelType: 'whatsapp',
        automationId: input.automationId,
        templateRef: input.templateRef,
        templateLanguage: input.language,
        templateParameters: [...input.parameters],
      },
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      occurredAt: now,
      providerSequence: null,
    });
    const persisted = await this.persistPendingMessage(
      pending,
      channel,
      input.conversation,
    );
    if (!persisted.created) {
      return {
        conversation: input.conversation,
        message: persisted.message,
        meta: {},
      };
    }

    const ledger = await this.metaLedger.reserve({
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      conversationId: input.conversation.id,
      messageId: persisted.message.id,
      operation: 'send_template',
      idempotencyKey: input.idempotencyKey,
      recipient,
    });
    const startedMs = Date.now();
    let response: MetaSendMessageResponse;
    try {
      await this.metaLedger.started(ledger);
      response = await this.sendTemplateToMeta({
        phoneNumberId: channel.externalPhoneNumberId,
        accessToken,
        to: recipient.transportRecipient,
        expectedTo: input.conversation.externalThreadId as string,
        templateRef: input.templateRef,
        language: input.language,
        parameters: input.parameters,
      });
      await this.metaLedger.succeeded(
        ledger,
        startedMs,
        response.messages?.[0]?.id,
      );
    } catch (error) {
      await this.metaLedger.failed(ledger, startedMs, error);
      persisted.message.status = 'failed';
      persisted.message.metadata = {
        ...persisted.message.metadata,
        errorCode: 'provider_send_failed',
      };
      await this.messagesRepository.save(persisted.message);
      throw error;
    }

    const sentAt = new Date();
    const externalMessageId = response.messages?.[0]?.id ?? null;
    await this.dataSource.transaction(async (manager) => {
      persisted.message.externalMessageId = externalMessageId;
      persisted.message.status = 'sent';
      persisted.message.sentAt = sentAt;
      await manager.getRepository(InboxMessageEntity).save(persisted.message);

      input.conversation.lastMessagePreview = '[modelo de mensagem]';
      input.conversation.lastMessageAt = sentAt;
      if (input.conversation.status === 'new') {
        input.conversation.status = 'open';
      }
      await manager
        .getRepository(InboxConversationEntity)
        .save(input.conversation);

      await manager.getRepository(InboxConversationEventEntity).save({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: input.conversation.id,
        eventType: 'message_sent',
        actorType: 'system',
        actorUserId: null,
        payload: {
          messageId: persisted.message.id,
          externalMessageId,
          channelId: channel.id,
          channelType: 'whatsapp',
          provider: 'meta',
          automationId: input.automationId,
          templateRef: input.templateRef,
        },
      });
      await manager.getRepository(InboxDomainOutboxEntity).save({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        aggregateType: 'inbox_conversation',
        aggregateId: input.conversation.id,
        eventName: 'leadflow.inbox.conversation.message.sent',
        eventVersion: 1,
        idempotencyKey: `message.sent:${persisted.message.id}`,
        payload: {
          conversationId: input.conversation.id,
          contactId: input.conversation.contactId,
          messageId: persisted.message.id,
          messageType: 'template',
          authorType: 'system',
          automationId: input.automationId,
        },
        publishedAt: null,
      });
    });

    return {
      conversation: input.conversation,
      message: persisted.message,
      meta: response,
    };
  }

  private async sendTemplateToMeta(input: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    expectedTo: string;
    templateRef: string;
    language: string;
    parameters?: readonly string[];
  }): Promise<MetaSendMessageResponse> {
    const authorized = this.outboundPolicy.authorize(
      input.to,
      input.expectedTo,
    );
    const graphVersion = process.env.META_GRAPH_API_VERSION ?? 'v24.0';
    const url = `https://graph.facebook.com/${graphVersion}/${input.phoneNumberId}/messages`;
    // A template with no variables must keep sending exactly the body it sent
    // before: Meta rejects an empty `components` array as readily as a missing
    // parameter, so the key only appears when there is something to fill.
    const parameters = input.parameters ?? [];
    const components = parameters.length
      ? [
          {
            type: 'body',
            parameters: parameters.map((text) => ({ type: 'text', text })),
          },
        ]
      : undefined;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: authorized.transportRecipient,
        type: 'template',
        template: {
          name: input.templateRef,
          language: { code: input.language },
          ...(components ? { components } : {}),
        },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json()) as MetaSendMessageResponse;
    if (!response.ok || data.error) {
      const providerMessage = data.error?.message?.toLowerCase() ?? '';
      if (
        providerMessage.includes('language') ||
        providerMessage.includes('idioma')
      ) {
        throw new WhatsAppAutomationTemplateError('language_mismatch');
      }
      if (
        providerMessage.includes('component') ||
        providerMessage.includes('parameter') ||
        providerMessage.includes('parâmetro')
      ) {
        throw new WhatsAppAutomationTemplateError('components_unsupported');
      }
      throw new WhatsAppAutomationTemplateError('invalid');
    }
    return data;
  }

  private async sendToMeta(input: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    expectedTo: string;
    text: string;
    contextMessageId?: string;
  }): Promise<MetaSendMessageResponse> {
    const authorized = this.outboundPolicy.authorize(
      input.to,
      input.expectedTo,
    );
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
        to: authorized.transportRecipient,
        type: 'text',
        ...(input.contextMessageId
          ? { context: { message_id: input.contextMessageId } }
          : {}),
        text: {
          preview_url: false,
          body: input.text,
        },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await response.json()) as MetaSendMessageResponse;

    if (!response.ok || data.error) {
      throw new BadRequestException(
        [
          'Não foi possível enviar a mensagem pelo canal WhatsApp.',
          data.error?.message,
        ]
          .filter(Boolean)
          .join(' '),
      );
    }

    return data;
  }

  // Reação nativa do WhatsApp (type: reaction). Emoji vazio remove a reação.
  // Chamado pelo InboxService depois de persistir a reação no nosso metadata:
  // retorna false quando o canal/mensagem não suporta entrega (fica só local).
  async deliverReaction(input: {
    conversation: InboxConversationEntity;
    message: InboxMessageEntity;
    emoji: string;
  }): Promise<boolean> {
    const channelId = input.message.channelId ?? input.conversation.channelId;
    const externalMessageId = input.message.externalMessageId;
    const to = input.conversation.externalThreadId?.trim();

    if (!channelId || !externalMessageId || !to) return false;

    const channel = await this.channelsRepository.findOne({
      where: {
        id: channelId,
        tenantId: input.conversation.tenantId,
        workspaceId: input.conversation.workspaceId,
        type: 'whatsapp',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
    });

    if (!channel?.externalPhoneNumberId) return false;

    const accessToken = this.cryptoService.decrypt(
      channel.accessTokenEncrypted,
    );
    if (!accessToken) return false;

    const recipient = this.outboundPolicy.authorize(
      to,
      input.conversation.externalThreadId,
    );
    const idempotencyKey = `reaction:${input.message.id}:${input.emoji || 'remove'}`;
    const ledger = await this.metaLedger.reserve({
      tenantId: input.conversation.tenantId,
      workspaceId: input.conversation.workspaceId,
      channelId: channel.id,
      conversationId: input.conversation.id,
      messageId: input.message.id,
      operation: 'reaction',
      idempotencyKey,
      recipient,
    });
    if (ledger.succeededAt) {
      await this.metaLedger.replay({
        tenantId: input.conversation.tenantId,
        workspaceId: input.conversation.workspaceId,
        channelId: channel.id,
        conversationId: input.conversation.id,
        operation: 'reaction',
        idempotencyKey,
        recipient,
      });
      return true;
    }

    const graphVersion = process.env.META_GRAPH_API_VERSION ?? 'v24.0';
    const url = `https://graph.facebook.com/${graphVersion}/${channel.externalPhoneNumberId}/messages`;

    const startedMs = Date.now();
    await this.metaLedger.started(ledger);
    let response: Response;
    try {
      const authorized = this.outboundPolicy.authorize(
        recipient.transportRecipient,
        input.conversation.externalThreadId,
      );
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: authorized.transportRecipient,
          type: 'reaction',
          reaction: {
            message_id: externalMessageId,
            emoji: input.emoji,
          },
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      await this.metaLedger.failed(ledger, startedMs, error);
      throw error;
    }

    const data = (await response.json()) as MetaSendMessageResponse;

    if (!response.ok || data.error) {
      await this.metaLedger.failed(ledger, startedMs, {
        status: response.status,
      });
      throw new BadRequestException(
        [
          'Não foi possível enviar a reação pelo canal WhatsApp.',
          data.error?.message,
        ]
          .filter(Boolean)
          .join(' '),
      );
    }

    await this.metaLedger.succeeded(ledger, startedMs, data.messages?.[0]?.id);

    return true;
  }

  // Remux de áudio para ogg/opus. Tenta copiar o stream (instantâneo, sem
  // perda) e só re-encoda se o codec de origem não for Opus.
  private async convertAudioToOggOpus(
    file: Express.Multer.File,
  ): Promise<Buffer> {
    const ffmpegPath =
      process.env.FFMPEG_PATH?.trim() ||
      ((ffmpegStatic as unknown as string | null) ?? '');

    if (!ffmpegPath) {
      throw new BadRequestException(
        'Conversão de áudio indisponível no servidor (ffmpeg não encontrado).',
      );
    }

    const directory = await mkdtemp(join(tmpdir(), 'lyra-audio-'));
    const inputPath = join(directory, `in-${randomUUID()}`);
    const outputPath = join(directory, `out-${randomUUID()}.ogg`);

    try {
      await writeFile(inputPath, file.buffer);

      try {
        await execFileAsync(ffmpegPath, [
          '-y',
          '-i',
          inputPath,
          '-vn',
          '-c:a',
          'copy',
          '-f',
          'ogg',
          outputPath,
        ]);
      } catch {
        await execFileAsync(ffmpegPath, [
          '-y',
          '-i',
          inputPath,
          '-vn',
          '-c:a',
          'libopus',
          '-b:a',
          '32k',
          '-f',
          'ogg',
          outputPath,
        ]);
      }

      return await readFile(outputPath);
    } catch {
      throw new BadRequestException(
        'Não foi possível converter o áudio para um formato aceito pelo WhatsApp.',
      );
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  private async uploadMediaToMeta(input: {
    phoneNumberId: string;
    accessToken: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<string> {
    const graphVersion = process.env.META_GRAPH_API_VERSION ?? 'v24.0';
    const url = `https://graph.facebook.com/${graphVersion}/${input.phoneNumberId}/media`;

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', input.mimeType);
    form.append(
      'file',
      new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
      input.filename,
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}` },
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await response.json()) as {
      id?: string;
      error?: { message?: string };
    };

    if (!response.ok || !data.id) {
      const detail = data.error?.message ? ` (${data.error.message})` : '';
      throw new BadRequestException(
        `Não foi possível enviar a mídia ao canal WhatsApp.${detail}`,
      );
    }

    return data.id;
  }

  private async sendMediaToMeta(input: {
    phoneNumberId: string;
    accessToken: string;
    to: string;
    expectedTo: string;
    mediaType: WhatsAppMediaType;
    mediaId: string;
    caption: string;
    filename: string;
  }): Promise<MetaSendMessageResponse> {
    const authorized = this.outboundPolicy.authorize(
      input.to,
      input.expectedTo,
    );
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
        to: authorized.transportRecipient,
        type: input.mediaType,
        [input.mediaType]: mediaPayload,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await response.json()) as MetaSendMessageResponse;

    if (!response.ok || data.error) {
      const detail = data.error?.message ? ` (${data.error.message})` : '';
      throw new BadRequestException(
        `Não foi possível enviar a mídia pelo canal WhatsApp.${detail}`,
      );
    }

    return data;
  }
}
