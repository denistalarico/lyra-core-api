import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { MetaGraphService } from '../../meta/services/meta-graph.service';

const PROFILE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const MAX_PROFILES_PER_REQUEST = 12;
const PROFILE_STRATEGY_VERSION = 1;

/**
 * Repairs profiles that predate Instagram profile enrichment and periodically
 * renews Meta CDN avatar URLs, which are temporary and eventually return 403.
 */
@Injectable()
export class InstagramContactEnrichmentService {
  constructor(
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    @InjectRepository(InboxConversationEntity, 'agency')
    private readonly conversationsRepository: Repository<InboxConversationEntity>,
    private readonly cryptoService: SettingsCryptoService,
    private readonly metaGraphService: MetaGraphService,
  ) {}

  async refreshProfiles(conversations: InboxConversationEntity[]) {
    const now = Date.now();
    const candidates = conversations
      .filter((conversation) => this.needsRefresh(conversation, now))
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
        type: 'instagram',
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
        await this.refreshConversation(conversation, channel);
      }),
    );
  }

  private async refreshConversation(
    conversation: InboxConversationEntity,
    channel: InboxChannelEntity,
  ) {
    const attemptedAt = new Date().toISOString();
    const metadata: Record<string, unknown> = {
      ...(conversation.metadata ?? {}),
      instagramProfileLookupAttemptedAt: attemptedAt,
      instagramProfileStrategyVersion: PROFILE_STRATEGY_VERSION,
    };
    const scopedUserId = this.resolveScopedUserId(conversation);

    try {
      const accessToken = this.cryptoService.decrypt(
        channel.accessTokenEncrypted,
      );
      if (accessToken && scopedUserId) {
        const profile =
          channel.metadata?.authorizationMethod === 'facebook_login'
            ? await this.metaGraphService.getFacebookInstagramUserProfile({
                scopedUserId,
                pageAccessToken: accessToken,
              })
            : await this.metaGraphService.getInstagramUserProfile({
                scopedUserId,
                accessToken,
              });

        if (profile.name) metadata.contactName = profile.name;
        if (profile.username) metadata.username = profile.username;
        if (profile.profilePictureUrl) {
          metadata.avatarUrl = profile.profilePictureUrl;
        }
        if (profile.name || profile.username || profile.profilePictureUrl) {
          metadata.instagramProfileSyncedAt = attemptedAt;
        }
      }
    } catch {
      // Best effort: an expired token or a temporary Meta error must not make
      // the Inbox listing fail. The retry timestamp prevents request storms.
    }

    const title = this.resolveTitle(conversation, metadata);
    await this.conversationsRepository.update(
      {
        id: conversation.id,
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
      },
      { metadata: metadata as never, title },
    );
    conversation.metadata = metadata;
    conversation.title = title;
  }

  private needsRefresh(conversation: InboxConversationEntity, now: number) {
    if (
      conversation.source !== 'instagram' &&
      !conversation.externalThreadId?.startsWith('instagram:')
    ) {
      return false;
    }
    const metadata = conversation.metadata ?? {};
    if (metadata.instagramProfileStrategyVersion !== PROFILE_STRATEGY_VERSION) {
      return true;
    }

    const lastAttempt = Date.parse(
      this.readString(metadata.instagramProfileLookupAttemptedAt) ?? '',
    );
    return (
      !Number.isFinite(lastAttempt) ||
      now - lastAttempt >= PROFILE_REFRESH_INTERVAL_MS
    );
  }

  private resolveScopedUserId(conversation: InboxConversationEntity) {
    const metadata = conversation.metadata ?? {};
    const fromMetadata =
      this.readString(metadata.externalParticipantId) ??
      this.readString(metadata.instagramScopedId);
    const threadId = conversation.externalThreadId?.trim() ?? '';
    const fromThread = threadId.startsWith('instagram:')
      ? (threadId.split(':').at(-1) ?? null)
      : null;
    const value = fromMetadata?.trim() || fromThread?.trim() || '';
    return /^[A-Za-z0-9_-]{1,180}$/.test(value) ? value : null;
  }

  private resolveTitle(
    conversation: InboxConversationEntity,
    metadata: Record<string, unknown>,
  ) {
    if (!this.isPlaceholderTitle(conversation.title)) return conversation.title;
    const name = this.readString(metadata.contactName);
    const username = this.readString(metadata.username);
    const resolved =
      name || (username ? `@${username.replace(/^@/, '')}` : null);
    return resolved?.slice(0, 180) ?? conversation.title;
  }

  private isPlaceholderTitle(value: string | null) {
    const normalized = value?.trim() ?? '';
    return (
      !normalized ||
      /^instagram:/i.test(normalized) ||
      /^\d{8,}$/.test(normalized) ||
      ['Nova conversa', 'Conversa sem título', 'Lead do Instagram'].includes(
        normalized,
      )
    );
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
