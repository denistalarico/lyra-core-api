import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import type { ChannelAdapterResult } from '../../types/channel-adapter';
import type {
  NormalizedInboundAttachment,
  NormalizedInboundMessage,
  NormalizedInboundMessageType,
} from '../../types/normalized-inbound-message';
import { MetaChannelResolverService } from '../services/meta-channel-resolver.service';
import { MetaGraphService } from '../services/meta-graph.service';
import type { NormalizedMessageReactionUpdate } from '../../types/normalized-message-reaction-update';
import type { NormalizedMessageStatusUpdate } from '../../types/normalized-message-status-update';
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

  constructor(
    private readonly channelResolver: MetaChannelResolverService,
    private readonly metaGraphService: MetaGraphService,
    private readonly cryptoService: SettingsCryptoService,
  ) {}

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

        const profile = await this.loadProfile(channel, senderId);
        messages.push(
          this.normalizeMessage({
            tenantId: channel.tenantId,
            workspaceId: channel.workspaceId,
            channelId: channel.id,
            accountId,
            entry,
            event,
            message: event.message,
            profile,
          }),
        );
      }
    }

    return { messages };
  }

  async normalizeStatuses(
    payload: MetaInstagramWebhookPayload,
  ): Promise<{ statuses: NormalizedMessageStatusUpdate[] }> {
    const statuses: NormalizedMessageStatusUpdate[] = [];

    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        const accountId = entry.id ?? event.sender?.id;
        const externalMessageId = event.read?.mid;
        if (!accountId || !externalMessageId) continue;
        const channel =
          await this.channelResolver.findInstagramChannelByAccountId(accountId);
        statuses.push({
          tenantId: channel.tenantId,
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          provider: this.provider,
          channelType: 'instagram',
          externalMessageId,
          status: 'read',
          recipientId: event.sender?.id ?? null,
          occurredAt: this.parseTimestamp(event.timestamp ?? entry.time),
          metadata: { instagramAccountId: accountId },
        });
      }
    }

    return { statuses };
  }

  async normalizeReactions(
    payload: MetaInstagramWebhookPayload,
  ): Promise<{ reactions: NormalizedMessageReactionUpdate[] }> {
    const reactions: NormalizedMessageReactionUpdate[] = [];

    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.reaction?.mid) continue;
        const accountId = entry.id ?? event.recipient?.id;
        if (!accountId) continue;
        const channel =
          await this.channelResolver.findInstagramChannelByAccountId(accountId);
        reactions.push({
          tenantId: channel.tenantId,
          workspaceId: channel.workspaceId,
          channelId: channel.id,
          provider: this.provider,
          channelType: 'instagram',
          externalMessageId: event.reaction.mid,
          senderId: event.sender?.id ?? null,
          action: event.reaction.action === 'unreact' ? 'unreact' : 'react',
          emoji: event.reaction.emoji?.trim() || null,
          occurredAt: this.parseTimestamp(event.timestamp ?? entry.time),
        });
      }
    }

    return { reactions };
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
    profile: {
      name: string | null;
      username: string | null;
      profilePictureUrl: string | null;
    } | null;
  }): NormalizedInboundMessage {
    const {
      tenantId,
      workspaceId,
      channelId,
      accountId,
      entry,
      event,
      message,
      profile,
    } = input;
    const senderId = event.sender?.id as string;
    const attachments = this.extractAttachments(
      message.attachments,
      message.mid ?? null,
    );

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
        name: profile?.name ?? null,
        username: profile?.username ?? event.sender?.username ?? null,
        metadata: {
          instagramScopedId: senderId,
          avatarUrl: profile?.profilePictureUrl ?? null,
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

  private async loadProfile(
    channel: {
      accessTokenEncrypted?: string | null;
      metadata?: Record<string, unknown>;
    },
    scopedUserId: string,
  ) {
    try {
      const accessToken = this.cryptoService.decrypt(
        channel.accessTokenEncrypted ?? null,
      );
      if (!accessToken) return null;
      if (channel.metadata?.authorizationMethod === 'facebook_login') {
        return await this.metaGraphService.getFacebookInstagramUserProfile({
          scopedUserId,
          pageAccessToken: accessToken,
        });
      }
      return await this.metaGraphService.getInstagramUserProfile({
        scopedUserId,
        accessToken,
      });
    } catch {
      return null;
    }
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
          externalId: `instagram:${messageId ?? urlHash}:${index}`,
          metadata: {
            instagramAttachmentType: attachment.type ?? null,
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
