import { Injectable } from '@nestjs/common';
import type { ChannelAdapterResult } from '../../types/channel-adapter';
import type {
  NormalizedInboundMessage,
  NormalizedInboundMessageType,
} from '../../types/normalized-inbound-message';
import { MetaChannelResolverService } from '../services/meta-channel-resolver.service';
import type {
  MetaWhatsAppChangeValue,
  MetaWhatsAppMessage,
  MetaWhatsAppWebhookPayload,
} from '../types/meta-whatsapp-webhook.types';
import type { NormalizedMessageReactionUpdate } from '../../types/normalized-message-reaction-update';
import type { NormalizedMessageStatusUpdate } from '../../types/normalized-message-status-update';

@Injectable()
export class WhatsAppMetaAdapter {
  readonly provider = 'meta';

  constructor(private readonly channelResolver: MetaChannelResolverService) {}

  async normalize(
    payload: MetaWhatsAppWebhookPayload,
  ): Promise<ChannelAdapterResult> {
    const messages: NormalizedInboundMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!value || !phoneNumberId || !value.messages?.length) continue;

        const channel =
          await this.channelResolver.findWhatsAppChannelByPhoneNumberId(
            phoneNumberId,
          );

        for (const rawMessage of value.messages) {
          // Reactions arrive in the same `messages` array as regular
          // messages, tagged with type "reaction" — they resolve through
          // normalizeReactions instead, never as an inbound message.
          if (rawMessage.type === 'reaction') continue;

          messages.push(
            this.normalizeMessage({
              tenantId: channel.tenantId,
              workspaceId: channel.workspaceId,
              channelId: channel.id,
              value,
              rawMessage,
              payload,
            }),
          );
        }
      }
    }

    return { messages };
  }

  async normalizeStatuses(
    payload: MetaWhatsAppWebhookPayload,
  ): Promise<{ statuses: NormalizedMessageStatusUpdate[] }> {
    const statuses: NormalizedMessageStatusUpdate[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!value || !phoneNumberId || !value.statuses?.length) continue;

        const channel =
          await this.channelResolver.findWhatsAppChannelByPhoneNumberId(
            phoneNumberId,
          );

        for (const rawStatus of value.statuses) {
          if (!rawStatus.id) continue;

          statuses.push({
            tenantId: channel.tenantId,
            workspaceId: channel.workspaceId,
            channelId: channel.id,
            provider: this.provider,
            channelType: 'whatsapp',
            externalMessageId: rawStatus.id,
            status: this.mapDeliveryStatus(rawStatus.status),
            recipientId: rawStatus.recipient_id ?? null,
            occurredAt: this.parseTimestamp(rawStatus.timestamp),
            metadata: {
              phoneNumberId,
            },
          });
        }
      }
    }

    return { statuses };
  }

  async normalizeReactions(
    payload: MetaWhatsAppWebhookPayload,
  ): Promise<{ reactions: NormalizedMessageReactionUpdate[] }> {
    const reactions: NormalizedMessageReactionUpdate[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const phoneNumberId = value?.metadata?.phone_number_id;

        if (!value || !phoneNumberId || !value.messages?.length) continue;

        const channel =
          await this.channelResolver.findWhatsAppChannelByPhoneNumberId(
            phoneNumberId,
          );

        for (const rawMessage of value.messages) {
          const externalMessageId = rawMessage.reaction?.message_id;
          if (rawMessage.type !== 'reaction' || !externalMessageId) continue;

          reactions.push({
            tenantId: channel.tenantId,
            workspaceId: channel.workspaceId,
            channelId: channel.id,
            provider: this.provider,
            channelType: 'whatsapp',
            externalMessageId,
            senderId: rawMessage.from ?? null,
            action: rawMessage.reaction?.emoji ? 'react' : 'unreact',
            emoji: rawMessage.reaction?.emoji?.trim() || null,
            occurredAt: this.parseTimestamp(rawMessage.timestamp),
            metadata: { phoneNumberId },
          });
        }
      }
    }

    return { reactions };
  }

  private mapDeliveryStatus(status: string | undefined) {
    switch (status) {
      case 'sent':
        return 'sent';
      case 'delivered':
        return 'delivered';
      case 'read':
        return 'read';
      case 'failed':
        return 'failed';
      default:
        return 'unknown';
    }
  }

  private normalizeMessage(input: {
    tenantId: string;
    workspaceId: string;
    channelId: string;
    value: MetaWhatsAppChangeValue;
    rawMessage: MetaWhatsAppMessage;
    payload: MetaWhatsAppWebhookPayload;
  }): NormalizedInboundMessage {
    const { tenantId, workspaceId, channelId, value, rawMessage, payload } =
      input;

    const from = rawMessage.from ?? 'unknown';
    const contact = value.contacts?.find((item) => item.wa_id === from);
    const messageType = this.mapMessageType(rawMessage.type);
    const content = this.extractContent(rawMessage);

    return {
      tenantId,
      workspaceId,
      channelId,
      channelType: 'whatsapp',
      provider: this.provider,
      externalThreadId: from,
      externalMessageId: rawMessage.id ?? null,
      sender: {
        externalId: from,
        name: contact?.profile?.name ?? null,
        phone: from,
        metadata: {
          waId: contact?.wa_id ?? from,
          displayPhoneNumber: value.metadata?.display_phone_number ?? null,
          phoneNumberId: value.metadata?.phone_number_id ?? null,
        },
      },
      messageType,
      content,
      attachments: this.extractAttachments(rawMessage),
      occurredAt: this.parseTimestamp(rawMessage.timestamp),
      metadata: {
        metaObject: payload.object ?? null,
        whatsappMessageType: rawMessage.type ?? null,
        phoneNumberId: value.metadata?.phone_number_id ?? null,
        referralTrusted: Boolean(rawMessage.referral),
        referral: rawMessage.referral
          ? {
              adId: rawMessage.referral.source_id ?? null,
              sourceType: rawMessage.referral.source_type ?? null,
              clickId: rawMessage.referral.ctwa_clid ?? null,
            }
          : null,
      },
    };
  }

  private mapMessageType(
    type: string | undefined,
  ): NormalizedInboundMessageType {
    switch (type) {
      case 'text':
        return 'text';
      case 'image':
        return 'image';
      case 'audio':
        return 'audio';
      case 'video':
        return 'video';
      case 'document':
        return 'file';
      case 'location':
        return 'location';
      case 'contacts':
        return 'contact';
      default:
        return 'unknown';
    }
  }

  private extractContent(message: MetaWhatsAppMessage) {
    switch (message.type) {
      case 'text':
        return message.text?.body ?? '';
      case 'image':
        return message.image?.caption ?? '[Imagem recebida]';
      case 'audio':
        return '[Áudio recebido]';
      case 'video':
        return message.video?.caption ?? '[Vídeo recebido]';
      case 'document':
        return message.document?.filename
          ? `[Documento recebido: ${message.document.filename}]`
          : '[Documento recebido]';
      case 'location':
        return message.location?.name || message.location?.address
          ? `[Localização recebida: ${
              message.location.name ?? message.location.address
            }]`
          : '[Localização recebida]';
      case 'contacts':
        return '[Contato recebido]';
      case 'button':
        return message.button?.text ?? message.button?.payload ?? '[Botão]';
      case 'interactive':
        return '[Mensagem interativa recebida]';
      default:
        return '[Mensagem recebida]';
    }
  }

  private extractAttachments(message: MetaWhatsAppMessage) {
    if (message.type === 'image' && message.image?.id) {
      return [
        {
          type: 'image',
          externalId: message.image.id,
          mimeType: message.image.mime_type ?? null,
          metadata: {
            sha256: message.image.sha256 ?? null,
            caption: message.image.caption ?? null,
          },
        },
      ];
    }

    if (message.type === 'audio' && message.audio?.id) {
      return [
        {
          type: 'audio',
          externalId: message.audio.id,
          mimeType: message.audio.mime_type ?? null,
          metadata: {
            sha256: message.audio.sha256 ?? null,
          },
        },
      ];
    }

    if (message.type === 'video' && message.video?.id) {
      return [
        {
          type: 'video',
          externalId: message.video.id,
          mimeType: message.video.mime_type ?? null,
          metadata: {
            sha256: message.video.sha256 ?? null,
            caption: message.video.caption ?? null,
          },
        },
      ];
    }

    if (message.type === 'document' && message.document?.id) {
      return [
        {
          type: 'file',
          externalId: message.document.id,
          mimeType: message.document.mime_type ?? null,
          filename: message.document.filename ?? null,
          metadata: {
            sha256: message.document.sha256 ?? null,
            caption: message.document.caption ?? null,
          },
        },
      ];
    }

    return [];
  }

  private parseTimestamp(timestamp: string | undefined) {
    if (!timestamp) return new Date();

    const asNumber = Number(timestamp);
    if (Number.isNaN(asNumber)) return new Date();

    return new Date(asNumber * 1000);
  }
}
