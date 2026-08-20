import { Injectable } from '@nestjs/common';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import type { ChannelAdapterResult } from '../../types/channel-adapter';
import type { NormalizedInboundMessage } from '../../types/normalized-inbound-message';
import { MetaChannelResolverService } from '../services/meta-channel-resolver.service';
import { MetaGraphService } from '../services/meta-graph.service';
import type { MetaMessengerWebhookPayload } from '../types/meta-messenger-webhook.types';

type MessengerSenderProfile = {
  name: string | null;
  profilePictureUrl: string | null;
};

@Injectable()
export class MessengerMetaAdapter {
  readonly provider = 'meta';

  constructor(
    private readonly channelResolver: MetaChannelResolverService,
    private readonly metaGraphService: MetaGraphService,
    private readonly cryptoService: SettingsCryptoService,
  ) {}

  async normalize(
    payload: MetaMessengerWebhookPayload,
  ): Promise<ChannelAdapterResult> {
    const messages: NormalizedInboundMessage[] = [];
    // A single webhook delivery often batches several messages from the same
    // sender; the profile is looked up once per participant per delivery.
    const profiles = new Map<string, MessengerSenderProfile | null>();

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

        const profile = await this.resolveProfile(
          profiles,
          channel,
          pageId,
          senderId,
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
            name: profile?.name ?? null,
            // Messenger has no username: the Page-scoped user only exposes name
            // parts and picture. The field stays null instead of echoing the
            // PSID so the UI never renders an opaque id as a handle.
            username: null,
            metadata: {
              facebookPageScopedId: senderId,
              avatarUrl: profile?.profilePictureUrl ?? null,
            },
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

  private async resolveProfile(
    cache: Map<string, MessengerSenderProfile | null>,
    channel: { accessTokenEncrypted?: string | null },
    pageId: string,
    pageScopedUserId: string,
  ) {
    const cacheKey = `${pageId}:${pageScopedUserId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const profile = await this.loadProfile(channel, pageScopedUserId);
    cache.set(cacheKey, profile);
    return profile;
  }

  private async loadProfile(
    channel: { accessTokenEncrypted?: string | null },
    pageScopedUserId: string,
  ): Promise<MessengerSenderProfile | null> {
    try {
      const pageAccessToken = this.cryptoService.decrypt(
        channel.accessTokenEncrypted ?? null,
      );
      if (!pageAccessToken) return null;

      const profile =
        await this.metaGraphService.getFacebookMessengerUserProfile({
          pageScopedUserId,
          pageAccessToken,
        });

      return {
        name: profile.name,
        profilePictureUrl: profile.profilePictureUrl,
      };
    } catch {
      // Identity enrichment is best-effort: an expired token or a contact that
      // opted out of profile sharing must never drop the inbound message.
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
