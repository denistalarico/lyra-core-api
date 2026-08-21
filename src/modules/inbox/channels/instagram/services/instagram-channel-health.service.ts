import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import {
  FACEBOOK_PAGE_INSTAGRAM_WEBHOOK_FIELDS,
  INSTAGRAM_LOGIN_WEBHOOK_FIELDS,
  MetaGraphService,
} from '../../meta/services/meta-graph.service';

@Injectable()
export class InstagramChannelHealthService {
  constructor(
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    private readonly cryptoService: SettingsCryptoService,
    private readonly metaGraphService: MetaGraphService,
  ) {}

  async runHealthCheck(input: {
    tenantId: string;
    workspaceId: string;
    channelId: string;
  }) {
    const channel = await this.channelsRepository.findOne({
      where: {
        id: input.channelId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        type: 'instagram',
        provider: 'meta',
        deletedAt: IsNull(),
      },
    });

    if (!channel) {
      throw new NotFoundException('Instagram channel not found.');
    }
    if (
      channel.status !== 'active' ||
      channel.connectionStatus !== 'connected'
    ) {
      throw new BadRequestException('Instagram channel is not connected.');
    }
    if (!channel.externalAccountId) {
      throw new BadRequestException(
        'Instagram channel account identity is missing.',
      );
    }
    if (!channel.accessTokenEncrypted) {
      throw new BadRequestException('Instagram channel credential is missing.');
    }

    let accessToken: string | null;
    try {
      accessToken = this.cryptoService.decrypt(channel.accessTokenEncrypted);
    } catch {
      throw new BadRequestException(
        'Instagram channel credential could not be decrypted.',
      );
    }

    if (!accessToken) {
      throw new BadRequestException(
        'Instagram channel credential could not be decrypted.',
      );
    }

    const usesFacebookLogin =
      channel.metadata?.authorizationMethod === 'facebook_login';
    let username: string | null;
    let subscriptions: {
      appSubscribed: boolean;
      subscribedFields: string[];
    };

    if (usesFacebookLogin) {
      if (!channel.externalPageId) {
        throw new BadRequestException(
          'Instagram channel Facebook Page identity is missing.',
        );
      }
      let identity: Awaited<
        ReturnType<MetaGraphService['getFacebookPageInstagramAccount']>
      >;
      try {
        identity = await this.metaGraphService.getFacebookPageInstagramAccount({
          pageId: channel.externalPageId,
          pageAccessToken: accessToken,
        });
      } catch {
        throw new BadGatewayException(
          'Instagram did not accept the saved credential.',
        );
      }
      if (!identity || identity.accountId !== channel.externalAccountId) {
        throw new ConflictException(
          'Instagram account identity does not match this channel.',
        );
      }
      username = identity.username;
      try {
        subscriptions =
          await this.metaGraphService.getFacebookPageWebhookSubscriptions({
            pageId: channel.externalPageId,
            pageAccessToken: accessToken,
          });
      } catch {
        throw new BadGatewayException(
          'Instagram webhook subscription could not be verified.',
        );
      }
    } else {
      let identity: Awaited<
        ReturnType<MetaGraphService['getInstagramAuthorizedAccount']>
      >;
      try {
        identity =
          await this.metaGraphService.getInstagramAuthorizedAccount(
            accessToken,
          );
      } catch {
        throw new BadGatewayException(
          'Instagram did not accept the saved credential.',
        );
      }

      const providerAccountIds = new Set(
        [identity.accountId, identity.scopedId].filter(
          (value): value is string => Boolean(value),
        ),
      );
      const accountIdMatches = [channel.externalAccountId, channel.externalId]
        .filter((value): value is string => Boolean(value))
        .some((value) => providerAccountIds.has(value));
      if (!accountIdMatches) {
        throw new ConflictException(
          'Instagram account identity does not match this channel.',
        );
      }
      username = identity.username;
      try {
        subscriptions =
          await this.metaGraphService.getInstagramAccountWebhookSubscriptions({
            igUserId: identity.accountId,
            accessToken,
          });
      } catch {
        throw new BadGatewayException(
          'Instagram webhook subscription could not be verified.',
        );
      }
    }

    const expectedWebhookFields = usesFacebookLogin
      ? FACEBOOK_PAGE_INSTAGRAM_WEBHOOK_FIELDS
      : INSTAGRAM_LOGIN_WEBHOOK_FIELDS;
    const missingWebhookFields = expectedWebhookFields.filter(
      (field) => !subscriptions.subscribedFields.includes(field),
    );
    const webhookSubscriptionHealthy =
      subscriptions.appSubscribed && missingWebhookFields.length === 0;

    return {
      ok: webhookSubscriptionHealthy,
      channelId: channel.id,
      status: webhookSubscriptionHealthy
        ? ('healthy' as const)
        : ('unhealthy' as const),
      tokenValid: true as const,
      accountIdMatches: true as const,
      webhookSubscriptionHealthy,
      diagnosis: webhookSubscriptionHealthy
        ? null
        : subscriptions.appSubscribed
          ? ('webhook_subscription_incomplete' as const)
          : ('webhook_subscription_missing' as const),
      requiresReconnect: !webhookSubscriptionHealthy,
      missingWebhookFields,
      username,
      checkedAt: new Date().toISOString(),
    };
  }
}
