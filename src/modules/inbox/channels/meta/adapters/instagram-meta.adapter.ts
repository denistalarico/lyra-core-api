import { Injectable } from '@nestjs/common';
import type { ChannelAdapterResult } from '../../types/channel-adapter';
import type {
  NormalizedInboundAttachment,
  NormalizedInboundMessage,
  NormalizedInboundMessageType,
} from '../../types/normalized-inbound-message';
import { MetaChannelResolverService } from '../services/meta-channel-resolver.service';
import type {
  MetaInstagramAttachment,
  MetaInstagramEntry,
  MetaInstagramMessage,
  MetaInstagramMessagingEvent,
  MetaInstagramWebhookPayload,
} from '../types/meta-instagram-webhook.types';

@Injectable()
export class InstagramMetaAdapter {
  readonly provider = 'meta';

  constructor(private readonly channelResolver: MetaChannelResolverService) {}

  async normalize(
    payload: MetaInstagramWebhookPayload,
  ): Promise<ChannelAdapterResult> {
    const messages: NormalizedInboundMessage[] = [];

    if (payload.object !== 'instagram') return { messages };

    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!this.isInboundMessage(entry, event)) continue;

        const accountId = entry.id ?? event.recipient?.id;
        const senderId = event.sender?.id;
        if (!accountId || !senderId || !event.message) continue;

        const channel =
          await this.channelResolver.findInstagramChannelByAccountId(accountId);

        messages.push(
          this.normalizeMessage({
            tenantId: channel.tenantId,
            workspaceId: channel.workspaceId,
            channelId: channel.id,
            accountId,
            entry,
            event,
            message: event.message,
          }),
        );
      }
    }

    return { messages };
  }

  private isInboundMessage(
    entry: MetaInstagramEntry,
    event: MetaInstagramMessagingEvent,
  ) {
    const message = event.message;
    if (!message || message.is_echo || message.is_self) return false;

    const accountId = entry.id ?? event.recipient?.id;
    const senderId = event.sender?.id;
    const recipientId = event.recipient?.id;

    return Boolean(
      accountId &&
      senderId &&
      senderId !== accountId &&
      (!recipientId || recipientId === accountId),
    );
  }

  private normalizeMessage(input: {
    tenantId: string;
    workspaceId: string;
    channelId: string;
    accountId: string;
    entry: MetaInstagramEntry;
    event: MetaInstagramMessagingEvent;
    message: MetaInstagramMessage;
  }): NormalizedInboundMessage {
    const {
      tenantId,
      workspaceId,
      channelId,
      accountId,
      entry,
      event,
      message,
    } = input;
    const senderId = event.sender?.id as string;
    const attachments = this.extractAttachments(message.attachments);

    return {
      tenantId,
      workspaceId,
      channelId,
      channelType: 'instagram',
      provider: this.provider,
      // Instagram message webhooks do not expose a conversation ID. The stable
      // inbound participant pair identifies the 1:1 thread without trusting a
      // sender-only key across professional accounts.
      externalThreadId: `instagram:${accountId}:${senderId}`,
      externalMessageId: message.mid ?? null,
      sender: {
        externalId: senderId,
        username: event.sender?.username ?? null,
        metadata: {
          instagramScopedId: senderId,
        },
      },
      messageType: this.mapMessageType(message, attachments),
      content: this.extractContent(message, attachments),
      attachments,
      occurredAt: this.parseTimestamp(event.timestamp ?? entry.time),
      metadata: {
        metaObject: 'instagram',
        instagramAccountId: accountId,
        recipientId: event.recipient?.id ?? null,
        replyToMessageId: message.reply_to?.mid ?? null,
      },
    };
  }

  private mapMessageType(
    message: MetaInstagramMessage,
    attachments: NormalizedInboundAttachment[],
  ): NormalizedInboundMessageType {
    if (typeof message.text === 'string') return 'text';

    const type = attachments[0]?.type;
    if (type === 'image' || type === 'audio' || type === 'video') return type;
    if (type === 'file') return 'file';
    return 'unknown';
  }

  private extractContent(
    message: MetaInstagramMessage,
    attachments: NormalizedInboundAttachment[],
  ) {
    if (typeof message.text === 'string') return message.text;

    switch (attachments[0]?.type) {
      case 'image':
        return '[Imagem recebida]';
      case 'audio':
        return '[Audio recebido]';
      case 'video':
        return '[Video recebido]';
      case 'file':
        return '[Arquivo recebido]';
      default:
        return '[Mensagem recebida]';
    }
  }

  private extractAttachments(
    attachments: MetaInstagramAttachment[] | undefined,
  ): NormalizedInboundAttachment[] {
    return (attachments ?? []).flatMap((attachment) => {
      const type = this.mapAttachmentType(attachment.type);
      if (!type) return [];

      return [
        {
          type,
          url: attachment.payload?.url ?? null,
          // URL-only Instagram media remains normalized, but intentionally does
          // not enqueue the existing media ingestion worker during IG-1.
          externalId: null,
          metadata: {
            instagramAttachmentType: attachment.type ?? null,
          },
        },
      ];
    });
  }

  private mapAttachmentType(type: string | undefined) {
    switch (type) {
      case 'image':
        return 'image';
      case 'audio':
        return 'audio';
      case 'video':
      case 'ig_reel':
      case 'reel':
        return 'video';
      case 'file':
        return 'file';
      default:
        return null;
    }
  }

  private parseTimestamp(timestamp: number | undefined) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      return new Date();
    }

    return new Date(timestamp);
  }
}
