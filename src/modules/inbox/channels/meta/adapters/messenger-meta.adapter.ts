import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import type { ChannelAdapterResult } from '../../types/channel-adapter';
import type {
  NormalizedInboundAttachment,
  NormalizedInboundMessage,
  NormalizedInboundMessageType,
} from '../../types/normalized-inbound-message';
import type { NormalizedMessageReactionUpdate } from '../../types/normalized-message-reaction-update';
import type {
  NormalizedMessageStatusUpdate,
  NormalizedMessageStatusWatermarkUpdate,
} from '../../types/normalized-message-status-update';
import { MetaChannelResolverService } from '../services/meta-channel-resolver.service';
import { MetaGraphService } from '../services/meta-graph.service';
import type {
  MetaMessengerAttachment,
  MetaMessengerWebhookPayload,
} from '../types/meta-messenger-webhook.types';

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
        const rawText = event?.message?.text;
        const text =
          typeof rawText === 'string' && rawText.trim() ? rawText : null;
        const attachments = this.extractAttachments(
          event?.message?.attachments,
          messageId ?? null,
        );

        if (
          event?.message?.is_echo === true ||
          !senderId ||
          !messageId ||
          (!text && attachments.length === 0)
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
          messageType: this.mapMessageType(text, attachments),
          content: this.extractContent(text, attachments),
          attachments,
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
   * normalize() keeps discarding is_echo events as it does today (they are
   * routed here instead, never through the inbound path). Wired into
   * MetaWebhookController and requires `message_echoes` to be enabled for
   * this app in the Meta App Dashboard's webhook product config, in addition
   * to being requested by FACEBOOK_PAGE_MESSENGER_WEBHOOK_FIELDS.
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

    const profile = await this.loadProfile(channel, pageId, pageScopedUserId);
    cache.set(cacheKey, profile);
    return profile;
  }

  private async loadProfile(
    channel: { accessTokenEncrypted?: string | null },
    pageId: string,
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
          pageId,
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

  private mapMessageType(
    text: string | null,
    attachments: NormalizedInboundAttachment[],
  ): NormalizedInboundMessageType {
    if (text) return 'text';

    const type = attachments[0]?.type;
    if (type === 'image' || type === 'audio' || type === 'video') return type;
    if (type === 'file') return 'file';
    return 'unknown';
  }

  private extractContent(
    text: string | null,
    attachments: NormalizedInboundAttachment[],
  ) {
    if (text) return text;

    switch (attachments[0]?.type) {
      case 'image':
        return '[Imagem recebida]';
      case 'audio':
        return '[Áudio recebido]';
      case 'video':
        return '[Vídeo recebido]';
      case 'file':
        return '[Arquivo recebido]';
      default:
        return '[Mensagem recebida]';
    }
  }

  private extractAttachments(
    attachments: MetaMessengerAttachment[] | undefined,
    messageId: string | null,
  ): NormalizedInboundAttachment[] {
    return (attachments ?? []).flatMap((attachment, index) => {
      const type = this.mapAttachmentType(attachment.type);
      const url = attachment.payload?.url ?? null;
      if (!type || !url) return [];
      const urlHash = createHash('sha256')
        .update(url)
        .digest('hex')
        .slice(0, 32);

      return [
        {
          type,
          url,
          externalId: `facebook_messenger:${messageId ?? urlHash}:${index}`,
          metadata: {
            facebookAttachmentType: attachment.type ?? null,
            directUrl: url,
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
        return 'video';
      case 'file':
        return 'file';
      default:
        return null;
    }
  }
}
