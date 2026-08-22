import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { MetaGraphService } from '../../meta/services/meta-graph.service';

const PROFILE_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const MAX_PROFILES_PER_REQUEST = 12;
const PROFILE_STRATEGY_VERSION = 2;

/**
 * Backfills Messenger identity for conversations created before profile
 * enrichment existed, or whose webhook-time lookup failed temporarily.
 * Listing the Inbox therefore repairs old rows without a migration or a new
 * inbound message, while the persisted retry timestamp prevents poll storms.
 */
@Injectable()
export class FacebookMessengerContactEnrichmentService {
  constructor(
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    @InjectRepository(InboxConversationEntity, 'agency')
    private readonly conversationsRepository: Repository<InboxConversationEntity>,
    private readonly cryptoService: SettingsCryptoService,
    private readonly metaGraphService: MetaGraphService,
  ) {}

  async enrichMissingProfiles(conversations: InboxConversationEntity[]) {
    const now = Date.now();
    const candidates = conversations
      .filter((conversation) => this.needsEnrichment(conversation, now))
      .slice(0, MAX_PROFILES_PER_REQUEST);
    if (!candidates.length) return;

    const channelIds = [
      ...new Set(
        candidates
          .map((conversation) => conversation.channelId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (!channelIds.length) return;

    const channels = await this.channelsRepository.find({
      where: {
        id: In(channelIds),
        type: 'facebook_messenger',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        deletedAt: IsNull(),
      },
    });
    const channelsById = new Map(
      channels.map((channel) => [channel.id, channel]),
    );

    await Promise.allSettled(
      candidates.map(async (conversation) => {
        const channel = conversation.channelId
          ? channelsById.get(conversation.channelId)
          : null;
        if (
          !channel ||
          channel.tenantId !== conversation.tenantId ||
          channel.workspaceId !== conversation.workspaceId
        ) {
          return;
        }
        await this.enrichConversation(conversation, channel);
      }),
    );
  }

  private async enrichConversation(
    conversation: InboxConversationEntity,
    channel: InboxChannelEntity,
  ) {
    const attemptedAt = new Date().toISOString();
    const metadata: Record<string, unknown> = {
      ...(conversation.metadata ?? {}),
      messengerProfileLookupAttemptedAt: attemptedAt,
      messengerProfileStrategyVersion: PROFILE_STRATEGY_VERSION,
    };
    const pageScopedUserId = this.resolvePageScopedUserId(conversation);

    try {
      const pageAccessToken = this.cryptoService.decrypt(
        channel.accessTokenEncrypted,
      );
      if (pageAccessToken && pageScopedUserId) {
        const profile =
          await this.metaGraphService.getFacebookMessengerUserProfile({
            pageScopedUserId,
            pageAccessToken,
            pageId: this.resolvePageId(conversation, channel) ?? undefined,
          });
        if (profile.name) metadata.contactName = profile.name;
        if (profile.profilePictureUrl) {
          metadata.avatarUrl = profile.profilePictureUrl;
        }
        if (profile.name || profile.profilePictureUrl) {
          metadata.messengerProfileSyncedAt = attemptedAt;
        }
      }
    } catch {
      // Best effort: a profile permission/token issue must not break Inbox
      // listing. MetaGraphService already records sanitized diagnostics.
    }

    const enrichedName = this.readString(metadata.contactName);
    const title =
      enrichedName && this.isPlaceholderTitle(conversation.title)
        ? enrichedName.slice(0, 180)
        : conversation.title;

    await this.conversationsRepository.update(
      {
        id: conversation.id,
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
      },
      // TypeORM's deep-partial type cannot represent an arbitrary JSONB
      // record, although the column itself intentionally can.
      { metadata: metadata as never, title },
    );
    conversation.metadata = metadata;
    conversation.title = title;
  }

  private needsEnrichment(conversation: InboxConversationEntity, now: number) {
    if (
      conversation.source !== 'facebook_messenger' &&
      !conversation.externalThreadId?.startsWith('facebook_messenger:')
    ) {
      return false;
    }
    const metadata = conversation.metadata ?? {};
    if (
      this.readString(metadata.contactName) &&
      this.readString(metadata.avatarUrl)
    ) {
      return false;
    }
    if (metadata.messengerProfileStrategyVersion !== PROFILE_STRATEGY_VERSION) {
      return true;
    }

    const lastAttempt = Date.parse(
      this.readString(metadata.messengerProfileLookupAttemptedAt) ?? '',
    );
    return (
      !Number.isFinite(lastAttempt) ||
      now - lastAttempt >= PROFILE_RETRY_INTERVAL_MS
    );
  }

  private resolvePageScopedUserId(conversation: InboxConversationEntity) {
    const metadata = conversation.metadata ?? {};
    const fromMetadata =
      this.readString(metadata.externalParticipantId) ??
      this.readString(metadata.facebookPageScopedId);
    const threadId = conversation.externalThreadId?.trim() ?? '';
    const fromThread = threadId.startsWith('facebook_messenger:')
      ? (threadId.split(':').at(-1) ?? null)
      : null;
    const value = fromMetadata?.trim() || fromThread?.trim() || '';
    return /^[A-Za-z0-9_-]{1,180}$/.test(value) ? value : null;
  }

  private resolvePageId(
    conversation: InboxConversationEntity,
    channel: InboxChannelEntity,
  ) {
    const threadParts = conversation.externalThreadId?.split(':') ?? [];
    const fromThread =
      threadParts[0] === 'facebook_messenger' && threadParts.length >= 3
        ? threadParts[1]
        : null;
    const value = channel.externalPageId?.trim() || fromThread?.trim() || '';
    return /^[A-Za-z0-9_-]{1,180}$/.test(value) ? value : null;
  }

  private isPlaceholderTitle(value: string | null) {
    const normalized = value?.trim() ?? '';
    return (
      !normalized ||
      /^facebook_messenger:/i.test(normalized) ||
      /^\d{8,}$/.test(normalized) ||
      ['Nova conversa', 'Conversa sem título', 'Lead do Messenger'].includes(
        normalized,
      )
    );
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
