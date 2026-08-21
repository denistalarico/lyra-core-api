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
  FACEBOOK_PAGE_MESSENGER_WEBHOOK_FIELDS,
  MetaGraphService,
} from '../../meta/services/meta-graph.service';

@Injectable()
export class FacebookMessengerChannelHealthService {
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
        type: 'facebook_messenger',
        provider: 'meta',
        deletedAt: IsNull(),
      },
    });

    if (!channel) {
      throw new NotFoundException('Messenger channel not found.');
    }
    if (
      channel.status !== 'active' ||
      channel.connectionStatus !== 'connected'
    ) {
      throw new BadRequestException('Messenger channel is not connected.');
    }
    if (!channel.externalPageId) {
      throw new BadRequestException(
        'Messenger channel Page identity is missing.',
      );
    }
    if (!channel.accessTokenEncrypted) {
      throw new BadRequestException('Messenger channel credential is missing.');
    }

    let accessToken: string | null;
    try {
      accessToken = this.cryptoService.decrypt(channel.accessTokenEncrypted);
    } catch {
      throw new BadRequestException(
        'Messenger channel credential could not be decrypted.',
      );
    }

    if (!accessToken) {
      throw new BadRequestException(
        'Messenger channel credential could not be decrypted.',
      );
    }

    let identity: Awaited<
      ReturnType<MetaGraphService['getFacebookPageIdentity']>
    >;
    try {
      identity = await this.metaGraphService.getFacebookPageIdentity({
        pageAccessToken: accessToken,
      });
    } catch {
      throw new BadGatewayException(
        'Messenger did not accept the saved credential.',
      );
    }
    if (identity.pageId !== channel.externalPageId) {
      throw new ConflictException(
        'Messenger Page identity does not match this channel.',
      );
    }

    let subscriptions: {
      appSubscribed: boolean;
      subscribedFields: string[];
    };
    try {
      subscriptions =
        await this.metaGraphService.getFacebookPageWebhookSubscriptions({
          pageId: channel.externalPageId,
          pageAccessToken: accessToken,
        });
    } catch {
      throw new BadGatewayException(
        'Messenger webhook subscription could not be verified.',
      );
    }

    const missingWebhookFields = FACEBOOK_PAGE_MESSENGER_WEBHOOK_FIELDS.filter(
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
      pageName: identity.pageName,
      checkedAt: new Date().toISOString(),
    };
  }
}
