import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../../entities/inbox-conversation-event.entity';
import { InboxMessageEntity } from '../../../entities/inbox-message.entity';

type SendWhatsAppTextInput = {
  channelId: string;
  conversationId?: string;
  to: string;
  text: string;
};

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
    @InjectRepository(InboxChannelEntity)
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    @InjectRepository(InboxConversationEntity)
    private readonly conversationsRepository: Repository<InboxConversationEntity>,
    @InjectRepository(InboxMessageEntity)
    private readonly messagesRepository: Repository<InboxMessageEntity>,
    @InjectRepository(InboxConversationEventEntity)
    private readonly eventsRepository: Repository<InboxConversationEventEntity>,
    private readonly cryptoService: SettingsCryptoService,
  ) {}

  async sendText(input: SendWhatsAppTextInput) {
    const channel = await this.channelsRepository.findOne({
      where: {
        id: input.channelId,
        type: 'whatsapp',
        provider: 'meta',
        status: 'active',
        deletedAt: IsNull(),
      },
    });

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
      ? await this.findConversation(channel, input.conversationId)
      : await this.findOrCreateConversation(channel, input.to);

    const response = await this.sendToMeta({
      phoneNumberId: channel.externalPhoneNumberId,
      accessToken,
      to: input.to,
      text: input.text,
    });

    const externalMessageId = response.messages?.[0]?.id ?? null;

    const message = await this.messagesRepository.save(
      this.messagesRepository.create({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        channelId: channel.id,
        contactId: conversation.contactId ?? null,
        direction: 'outbound' as InboxMessageEntity['direction'],
        senderType: 'system' as InboxMessageEntity['senderType'],
        senderUserId: null,
        senderAgentId: null,
        externalMessageId,
        messageType: 'text' as InboxMessageEntity['messageType'],
        content: input.text,
        status: 'sent' as InboxMessageEntity['status'],
        attachments: [],
        metadata: {
          provider: 'meta',
          channelType: 'whatsapp',
          to: input.to,
          metaResponse: response,
        },
        sentAt: new Date(),
        deliveredAt: null,
        readAt: null,
      }),
    );

    conversation.lastMessagePreview = input.text.trim().slice(0, 260);
    conversation.lastMessageAt = message.sentAt ?? new Date();
    await this.conversationsRepository.save(conversation);

    await this.eventsRepository.save(
      this.eventsRepository.create({
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        conversationId: conversation.id,
        eventType: 'message_sent',
        actorType: 'system',
        actorUserId: null,
        payload: {
          messageId: message.id,
          externalMessageId,
          channelId: channel.id,
          channelType: 'whatsapp',
          provider: 'meta',
          to: input.to,
        },
      }),
    );

    return {
      conversation,
      message,
      meta: response,
    };
  }

  private async findConversation(
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

    if (!conversation) {
      throw new NotFoundException('Inbox conversation not found for channel.');
    }

    return conversation;
  }

  private async findOrCreateConversation(
    channel: InboxChannelEntity,
    externalThreadId: string,
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
        externalThreadId,
        title: externalThreadId,
        status: 'new',
        priority: 'normal',
        assignedUserId: null,
        assignedAgentId: null,
        source: 'whatsapp',
        businessMode: 'general',
        lastMessagePreview: null,
        lastMessageAt: null,
        unreadCount: 0,
        aiEnabled: false,
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
      throw new BadRequestException({
        message: 'Failed to send WhatsApp message.',
        status: response.status,
        error: data.error ?? data,
      });
    }

    return data;
  }
}
