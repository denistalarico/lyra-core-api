import { Injectable } from '@nestjs/common';
import type { ChannelAdapterResult } from '../../types/channel-adapter';
import type { NormalizedInboundMessage } from '../../types/normalized-inbound-message';
import { MetaChannelResolverService } from '../services/meta-channel-resolver.service';
import type { MetaMessengerWebhookPayload } from '../types/meta-messenger-webhook.types';

@Injectable()
export class MessengerMetaAdapter {
  readonly provider = 'meta';

  constructor(private readonly channelResolver: MetaChannelResolverService) {}

  async normalize(
    payload: MetaMessengerWebhookPayload,
  ): Promise<ChannelAdapterResult> {
    const messages: NormalizedInboundMessage[] = [];

    if (payload.object !== 'page' || !Array.isArray(payload.entry)) {
      return { messages };
    }

    for (const entry of payload.entry) {
      const pageId = entry?.id;
      if (!pageId || !Array.isArray(entry.messaging)) continue;

      for (const event of entry.messaging) {
        const senderId = event?.sender?.id;
        const messageId = event?.message?.mid;
        const text = event?.message?.text;

        if (
          event?.message?.is_echo === true ||
          !senderId ||
          !messageId ||
          typeof text !== 'string' ||
          !text.trim()
        ) {
          continue;
        }

        const channel =
          await this.channelResolver.findFacebookMessengerChannelByPageId(
            pageId,
          );

        messages.push({
          tenantId: channel.tenantId,
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          channelType: 'facebook_messenger',
          provider: this.provider,
          externalThreadId: `facebook_messenger:${pageId}:${senderId}`,
          externalMessageId: messageId,
          sender: {
            externalId: senderId,
            name: null,
            username: null,
          },
          messageType: 'text',
          content: text,
          attachments: [],
          occurredAt: this.parseTimestamp(event.timestamp ?? entry.time),
          metadata: {
            metaObject: 'page',
            facebookPageId: pageId,
            recipientId: event.recipient?.id ?? null,
          },
        });
      }
    }

    return { messages };
  }

  private parseTimestamp(timestamp: number | undefined) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      return new Date();
    }

    return new Date(timestamp);
  }
}
