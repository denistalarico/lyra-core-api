import { Injectable } from '@nestjs/common';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import type { ChannelAdapterResult } from '../../types/channel-adapter';
import type { NormalizedInboundMessage } from '../../types/normalized-inbound-message';
import type { NormalizedMessageReactionUpdate } from '../../types/normalized-message-reaction-update';
import type {
  NormalizedMessageStatusUpdate,
  NormalizedMessageStatusWatermarkUpdate,
} from '../../types/normalized-message-status-update';
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

  /**
   * Messenger reports delivery/read as a watermark (a timestamp up to which
   * everything the page sent is delivered/read), not per message id.
   * `delivery.mids` exists but is optional by Meta's own design, so it is
   * never used here — relying on it would leave silent gaps whenever a
   * provider omits it. Both delivery and read go through the shared
   * watermark path in MessageStatusSyncService.
   */
  async normalizeStatuses(payload: MetaMessengerWebhookPayload): Promise<{
    statuses: NormalizedMessageStatusUpdate[];
    statusWatermarks: NormalizedMessageStatusWatermarkUpdate[];
  }> {
    const statusWatermarks: NormalizedMessageStatusWatermarkUpdate[] = [];

    if (payload.object !== 'page' || !Array.isArray(payload.entry)) {
      return { statuses: [], statusWatermarks };
    }

    for (const entry of payload.entry) {
      const pageId = entry?.id;
      if (!pageId || !Array.isArray(entry.messaging)) continue;

      for (const event of entry.messaging) {
        const senderId = event?.sender?.id;
        const status = event.read ? 'read' : event.delivery ? 'delivered' : null;
        const watermark = event.read?.watermark ?? event.delivery?.watermark;

        if (!senderId || !status || typeof watermark !== 'number') continue;

        const channel =
          await this.channelResolver.findFacebookMessengerChannelByPageId(
            pageId,
          );

        statusWatermarks.push({
          tenantId: channel.tenantId,
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          provider: this.provider,
          channelType: 'facebook_messenger',
          externalThreadId: `facebook_messenger:${pageId}:${senderId}`,
          status,
          watermark: new Date(watermark),
          recipientId: senderId,
          metadata: { facebookPageId: pageId },
        });
      }
    }

    return { statuses: [], statusWatermarks };
  }

  async normalizeReactions(
    payload: MetaMessengerWebhookPayload,
  ): Promise<{ reactions: NormalizedMessageReactionUpdate[] }> {
    const reactions: NormalizedMessageReactionUpdate[] = [];

    if (payload.object !== 'page' || !Array.isArray(payload.entry)) {
      return { reactions };
    }

    for (const entry of payload.entry) {
      const pageId = entry?.id;
      if (!pageId || !Array.isArray(entry.messaging)) continue;

      for (const event of entry.messaging) {
        const senderId = event?.sender?.id;
        const mid = event.reaction?.mid;
        if (!senderId || !mid) continue;

        const channel =
          await this.channelResolver.findFacebookMessengerChannelByPageId(
            pageId,
          );

        reactions.push({
          tenantId: channel.tenantId,
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          provider: this.provider,
          channelType: 'facebook_messenger',
          externalMessageId: mid,
          senderId,
          action: event.reaction?.action === 'unreact' ? 'unreact' : 'react',
          emoji: event.reaction?.emoji?.trim() || null,
          occurredAt: this.parseTimestamp(event.timestamp ?? entry.time),
          metadata: { facebookPageId: pageId },
        });
      }
    }

    return { reactions };
  }

  /**
   * Extracts is_echo events into the same normalized shape as normalize(),
   * for InboundMessageIngestionService.ingestEcho() — which fixes direction
   * to 'outbound' instead of misattributing the send to the contact.
   * normalize() keeps discarding is_echo events as it does today: this
   * method is not wired into the webhook controller yet, and the Messenger
   * webhook subscription does not request `message_echoes`, so no echo
   * events reach either path in production. It exists so a future sprint
   * can wire live echo handling onto an already-race-safe foundation.
   */
  async normalizeEchoes(
    payload: MetaMessengerWebhookPayload,
  ): Promise<{ messages: NormalizedInboundMessage[] }> {
    const messages: NormalizedInboundMessage[] = [];

    if (payload.object !== 'page' || !Array.isArray(payload.entry)) {
      return { messages };
    }

    for (const entry of payload.entry) {
      const pageId = entry?.id;
      if (!pageId || !Array.isArray(entry.messaging)) continue;

      for (const event of entry.messaging) {
        const recipientId = event?.recipient?.id;
        const messageId = event?.message?.mid;
        const text = event?.message?.text;

        if (
          event?.message?.is_echo !== true ||
          !recipientId ||
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
          externalThreadId: `facebook_messenger:${pageId}:${recipientId}`,
          externalMessageId: messageId,
          sender: {
            externalId: pageId,
            name: null,
            username: null,
            metadata: { facebookPageId: pageId },
          },
          messageType: 'text',
          content: text,
          attachments: [],
          occurredAt: this.parseTimestamp(event.timestamp ?? entry.time),
          metadata: {
            metaObject: 'page',
            facebookPageId: pageId,
            recipientId,
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
